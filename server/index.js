// UMDC — API du site et du back-office, et fichiers construits en production.
//
//   npm run dev     → Vite (http://localhost:5173) + cette API (port 3000)
//   npm run build && npm start → tout sur http://localhost:3000

import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { sanitizeContent, publicContent, normalizePhone } from './content.js';
import { ensurePreview, warmPreviews } from './preview.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const DIST_DIR = path.join(ROOT, 'dist');
const PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;
const SESSION_TTL = 7 * 24 * 3600 * 1000;
const COOKIE = 'umdc_admin';
const MAX_AUDIO_BYTES = 60 * 1024 * 1024;
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.wav', '.flac']);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (PROD ? '' : 'umdc');
if (!ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD doit être défini en production.');
  process.exit(1);
}
if (!process.env.ADMIN_PASSWORD) console.warn('[umdc] Mot de passe admin par défaut « umdc » (développement uniquement).');

fs.mkdirSync(AUDIO_DIR, { recursive: true });
const db = openDb(DATA_DIR);
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : process.env.TRUST_PROXY);

/* ------------------------------------------------------------ utilitaires */

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

function isAdmin(req) {
  return db.hasSession(readCookie(req, COOKIE));
}

function sameSecret(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Petit limiteur en mémoire : n essais par fenêtre, par IP et par usage.
function limiter(max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const h = hits.get(key);
    if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + windowMs });
    else if (++h.n > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: 'Trop de tentatives. Réessaie plus tard.' });
    }
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    next();
  };
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Non connecté.' });
  // Les cookies sont SameSite=Strict ; on exige en plus un en-tête qu'un formulaire tiers ne peut pas poser.
  if (req.method !== 'GET' && req.get('X-UMDC-Admin') !== '1') return res.status(403).json({ error: 'Requête refusée.' });
  next();
}


/* ------------------------------------------------------------ API publique */

app.use('/api', express.json({ limit: '1mb' }));
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

app.get('/api/site', (req, res) => {
  res.json(publicContent(db.getContent().content));
});

app.post('/api/subscribe', limiter(10, 10 * 60 * 1000), (req, res) => {
  const phone = normalizePhone(typeof req.body?.phone === 'string' ? req.body.phone.slice(0, 40) : '');
  if (!phone) return res.status(400).json({ error: 'Numéro invalide.' });
  if (req.body?.consent !== true) return res.status(400).json({ error: 'Consentement requis.' });
  // Un pot de miel : un champ caché que seuls les robots remplissent.
  if (req.body?.website) return res.json({ ok: true });
  db.addSubscriber(phone);
  // Même réponse si le numéro était déjà inscrit : on ne révèle pas qui est sur la liste.
  res.json({ ok: true });
});

// Les sons ne sont servis qu'après la sortie (ou à l'admin, pour vérifier), et seulement en extrait :
// le fichier entier ne quitte jamais le serveur (l'admin l'écoute en entier dans l'onglet Sons).
app.get('/api/audio/:id', async (req, res) => {
  const { content } = db.getContent();
  const pub = publicContent(content);
  const admin = isAdmin(req);
  if (!pub.release.released && !admin) return res.status(404).end();
  const track = content.tracks.find((t) => t.id === req.params.id && (t.enabled || admin));
  if (!track || !track.audio) return res.status(404).end();
  const file = path.join(AUDIO_DIR, track.audio);
  if (!file.startsWith(AUDIO_DIR + path.sep) || !fs.existsSync(file)) return res.status(404).end();
  try {
    const preview = await ensurePreview(AUDIO_DIR, track.audio, track.previewStart, track.previewLength);
    res.set('Cache-Control', 'private, max-age=3600');
    res.sendFile(preview, { dotfiles: 'allow' });
  } catch (e) {
    console.error('[umdc] extrait impossible (ffmpeg installé ?) :', e.message);
    res.status(503).end();
  }
});

/* ------------------------------------------------------------ back-office */

app.post('/api/admin/login', limiter(8, 15 * 60 * 1000), (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!password || !sameSecret(password, ADMIN_PASSWORD)) return res.status(401).json({ error: 'Mot de passe incorrect.' });
  const token = db.createSession(SESSION_TTL);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: PROD, maxAge: SESSION_TTL, path: '/' });
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  db.deleteSession(readCookie(req, COOKIE));
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/admin/me', (req, res) => res.json({ admin: isAdmin(req) }));

app.get('/api/admin/content', requireAdmin, (req, res) => {
  const { content, updatedAt } = db.getContent();
  res.json({ content, updatedAt, released: publicContent(content).release.released, subscribers: db.countSubscribers() });
});

app.put('/api/admin/content', requireAdmin, (req, res) => {
  const current = db.getContent().content;
  const content = sanitizeContent(req.body?.content, current);
  const updatedAt = db.saveContent(content);
  warmPreviews(AUDIO_DIR, content.tracks);
  res.json({ content, updatedAt, released: publicContent(content).release.released });
});

app.get('/api/admin/subscribers', requireAdmin, (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
  res.json({ subscribers: db.listSubscribers(q), total: db.countSubscribers() });
});

app.get('/api/admin/subscribers.csv', requireAdmin, (req, res) => {
  const rows = db.listSubscribers('');
  const esc = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // pas de formule dans un tableur
    return '"' + s.replace(/"/g, '""') + '"';
  };
  // le numéro (+41…) est vérifié à l'inscription : il sort tel quel, au format international attendu par les outils d'envoi de SMS
  const csv = ['telephone,inscrit_le,consentement_le', ...rows.map((r) => ['"' + r.phone + '"', esc(r.created_at), esc(r.consent_at)].join(','))].join('\r\n');
  const day = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="umdc-numeros-${day}.csv"`);
  res.send('﻿' + csv + '\r\n');
});

app.delete('/api/admin/subscribers/:id', requireAdmin, (req, res) => {
  const ok = db.deleteSubscriber(Number(req.params.id));
  res.status(ok ? 200 : 404).json({ ok });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: AUDIO_DIR,
    filename: (req, file, cb) => {
      // Les navigateurs envoient le nom en UTF-8, que busboy lit en latin1.
      const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const ext = path.extname(original).toLowerCase();
      const base = path.basename(original, path.extname(original))
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'son';
      cb(null, `${base}-${crypto.randomBytes(3).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 10 },
  fileFilter: (req, file, cb) => cb(null, AUDIO_EXT.has(path.extname(file.originalname).toLowerCase())),
});

function listAudio() {
  return fs.readdirSync(AUDIO_DIR)
    .filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()))
    .map((f) => ({ name: f, size: fs.statSync(path.join(AUDIO_DIR, f)).size }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

app.get('/api/admin/audio', requireAdmin, (req, res) => res.json({ files: listAudio() }));

app.post('/api/admin/audio', requireAdmin, (req, res) => {
  upload.array('files')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? `Fichier trop lourd (${MAX_AUDIO_BYTES / 1024 / 1024} Mo max).` : 'Envoi impossible.';
      return res.status(400).json({ error: msg });
    }
    res.json({ uploaded: (req.files || []).map((f) => f.filename), files: listAudio() });
  });
});

app.get('/api/admin/audio/:name', requireAdmin, (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(AUDIO_DIR, name);
  if (!AUDIO_EXT.has(path.extname(name).toLowerCase()) || !fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

app.delete('/api/admin/audio/:name', requireAdmin, (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(AUDIO_DIR, name);
  if (!AUDIO_EXT.has(path.extname(name).toLowerCase()) || !fs.existsSync(file)) return res.status(404).json({ ok: false });
  fs.unlinkSync(file);
  // Les pistes qui pointaient sur ce fichier redeviennent muettes.
  const { content } = db.getContent();
  if (content.tracks.some((t) => t.audio === name)) {
    content.tracks = content.tracks.map((t) => (t.audio === name ? { ...t, audio: '' } : t));
    db.saveContent(content);
  }
  res.json({ ok: true, files: listAudio() });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Introuvable.' }));

/* ------------------------------------------------------------ fichiers du site */

if (fs.existsSync(DIST_DIR)) {
  app.get('/admin', (req, res, next) => (req.path === '/admin' ? res.redirect(301, '/admin/') : next()));
  app.use('/admin', (req, res, next) => { res.set('X-Robots-Tag', 'noindex'); next(); });
  app.use(express.static(DIST_DIR, {
    setHeaders(res, file) {
      if (file.includes(`${path.sep}assets${path.sep}`)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));
} else if (PROD) {
  console.warn('[umdc] Pas de dossier dist/ : lance « npm run build » avant « npm start ».');
}

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.type === 'entity.too.large' ? 'Requête trop volumineuse.' : 'Erreur serveur.' });
});

warmPreviews(AUDIO_DIR, db.getContent().content.tracks);

app.listen(PORT, () => {
  console.log(`[umdc] API prête sur http://localhost:${PORT}` + (fs.existsSync(DIST_DIR) ? ' (site construit servi aussi)' : ''));
});
