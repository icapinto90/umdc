#!/usr/bin/env node
'use strict';

/**
 * UMDC — serveur minimal, zéro dépendance.
 *
 *   node server.js            → http://localhost:3000
 *   PORT=8080 node server.js
 *   UMDC_ADMIN_PASSWORD=xxx node server.js
 *
 * Sert le site statique (public/), l'API publique et l'API d'administration.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const AUDIO_DIR = path.join(PUBLIC_DIR, 'audio');
const DATA_DIR = path.join(ROOT, 'data');
const SITE_FILE = path.join(DATA_DIR, 'site.json');
const SUBS_FILE = path.join(DATA_DIR, 'subscribers.json');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.UMDC_ADMIN_PASSWORD || 'umdc';
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

/* ---------------------------------------------------------------- stockage */

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function loadSite() {
  return readJson(SITE_FILE, {});
}

function loadSubscribers() {
  const list = readJson(SUBS_FILE, []);
  return Array.isArray(list) ? list : [];
}

/* ------------------------------------------------------- logique métier */

// La sortie est active si l'admin l'a forcée, ou si la date est passée.
function isReleased(site) {
  const release = site.release || {};
  if (release.mode === 'on') return true;
  if (release.mode === 'off') return false;
  const date = Date.parse(release.date || '');
  return Number.isFinite(date) && Date.now() >= date;
}

// Vue publique : on n'expose jamais la tracklist audio avant la sortie.
function publicSite(site) {
  const released = isReleased(site);
  const tracks = (site.tracks || []).map((track, index) => ({
    id: track.id || 't' + (index + 1),
    n: index + 1,
    title: track.title || '',
    feat: track.feat || '',
    audio: released && track.released !== false ? track.audio || '' : '',
    links: released && track.released !== false ? track.links || {} : {},
    playable: Boolean(released && track.released !== false && track.audio),
  }));

  return {
    brand: site.brand || {},
    release: {
      released,
      date: (site.release || {}).date || '',
      albumTitle: (site.release || {}).albumTitle || '',
      listenHeadline: (site.release || {}).listenHeadline || '',
    },
    nav: (site.nav || []).filter((item) => item.visible !== false),
    socials: (site.socials || []).filter((item) => item.url),
    platforms: released ? (site.platforms || []).filter((item) => item.url) : [],
    newsletter: site.newsletter || {},
    contact: site.contact || {},
    tracks,
  };
}

function isValidEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

/* ----------------------------------------------------------------- http */

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), { 'Content-Type': MIME['.json'] });
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('payload trop volumineux'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function isAdmin(req) {
  const given = req.headers['x-umdc-key'];
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function serveStatic(req, res, urlPath) {
  const relative = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, relative);

  // Empêche toute sortie de public/.
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Interdit');

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, 'Introuvable');

    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;

    // Les lecteurs audio ont besoin des requêtes partielles pour chercher dans la piste.
    if (range && /^bytes=\d*-\d*$/.test(range)) {
      const [rawStart, rawEnd] = range.replace('bytes=', '').split('-');
      const start = rawStart ? Number(rawStart) : 0;
      const end = rawEnd ? Math.min(Number(rawEnd), stat.size - 1) : stat.size - 1;
      if (start <= end && start < stat.size) {
        res.writeHead(206, {
          'Content-Type': type,
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
        });
        return fs.createReadStream(filePath, { start, end }).pipe(res);
      }
    }

    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

/* --------------------------------------------------------------- routes */

async function handleApi(req, res, urlPath) {
  const method = req.method;

  if (urlPath === '/api/site' && method === 'GET') {
    return sendJson(res, 200, publicSite(loadSite()));
  }

  if (urlPath === '/api/subscribe' && method === 'POST') {
    const body = JSON.parse((await readBody(req, 8 * 1024)).toString('utf8') || '{}');
    const email = String(body.email || '').trim().toLowerCase();
    if (!isValidEmail(email)) return sendJson(res, 400, { error: 'Email invalide.' });

    const subscribers = loadSubscribers();
    if (!subscribers.some((entry) => entry.email === email)) {
      subscribers.push({ email, date: new Date().toISOString(), source: body.source || 'site' });
      writeJson(SUBS_FILE, subscribers);
    }
    return sendJson(res, 200, { ok: true });
  }

  if (urlPath === '/api/admin/login' && method === 'POST') {
    return sendJson(res, isAdmin(req) ? 200 : 401, { ok: isAdmin(req) });
  }

  // Tout ce qui suit demande le mot de passe.
  if (urlPath.startsWith('/api/admin/') && !isAdmin(req)) {
    return sendJson(res, 401, { error: 'Mot de passe requis.' });
  }

  if (urlPath === '/api/admin/site' && method === 'GET') {
    return sendJson(res, 200, { site: loadSite(), released: isReleased(loadSite()) });
  }

  if (urlPath === '/api/admin/site' && method === 'PUT') {
    const site = JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString('utf8'));
    if (!site || typeof site !== 'object') return sendJson(res, 400, { error: 'JSON invalide.' });
    writeJson(SITE_FILE, site);
    return sendJson(res, 200, { ok: true, released: isReleased(site) });
  }

  if (urlPath === '/api/admin/subscribers' && method === 'GET') {
    return sendJson(res, 200, { subscribers: loadSubscribers() });
  }

  if (urlPath === '/api/admin/subscribers' && method === 'DELETE') {
    writeJson(SUBS_FILE, []);
    return sendJson(res, 200, { ok: true });
  }

  if (urlPath === '/api/admin/audio' && method === 'GET') {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    const files = fs
      .readdirSync(AUDIO_DIR)
      .filter((name) => MIME[path.extname(name).toLowerCase()]?.startsWith('audio/'))
      .map((name) => ({ name, url: 'audio/' + name, size: fs.statSync(path.join(AUDIO_DIR, name)).size }));
    return sendJson(res, 200, { files });
  }

  if (urlPath === '/api/admin/audio' && method === 'POST') {
    const raw = String(req.headers['x-filename'] || '');
    const ext = path.extname(raw).toLowerCase();
    if (!['.mp3', '.m4a', '.wav', '.ogg'].includes(ext)) {
      return sendJson(res, 400, { error: 'Formats acceptés : mp3, m4a, wav, ogg.' });
    }
    // Nom de fichier assaini : on ne garde jamais le chemin fourni par le client.
    const base = path
      .basename(raw, ext)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'piste';
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    let name = base + ext;
    let i = 2;
    while (fs.existsSync(path.join(AUDIO_DIR, name))) name = `${base}-${i++}${ext}`;

    const data = await readBody(req, MAX_AUDIO_BYTES);
    fs.writeFileSync(path.join(AUDIO_DIR, name), data);
    return sendJson(res, 200, { ok: true, name, url: 'audio/' + name });
  }

  if (urlPath.startsWith('/api/admin/audio/') && method === 'DELETE') {
    const name = path.basename(decodeURIComponent(urlPath.slice('/api/admin/audio/'.length)));
    const filePath = path.join(AUDIO_DIR, name);
    if (filePath.startsWith(AUDIO_DIR + path.sep) && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'Route inconnue.' });
}

/* ---------------------------------------------------- export statique */

// `node server.js export` fige la vue publique dans public/site.json : le site
// tourne alors sans Node (sans la newsletter ni l'admin). À relancer après
// chaque changement — et notamment le jour de la sortie.
if (process.argv[2] === 'export') {
  const target = path.join(PUBLIC_DIR, 'site.json');
  const view = publicSite(loadSite());
  writeJson(target, view);
  console.log(`Export écrit : ${path.relative(ROOT, target)}`);
  console.log(`Onglet Écouter : ${view.release.released ? 'ouvert' : 'fermé'}`);
  process.exit(0);
}

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];

  if (urlPath.startsWith('/api/')) {
    handleApi(req, res, urlPath).catch((err) => {
      sendJson(res, 400, { error: err.message || 'Requête invalide.' });
    });
    return;
  }

  if (urlPath === '/admin') return serveStatic(req, res, '/admin.html');
  serveStatic(req, res, urlPath);
});

fs.mkdirSync(AUDIO_DIR, { recursive: true });
if (!fs.existsSync(SUBS_FILE)) writeJson(SUBS_FILE, []);

server.listen(PORT, () => {
  console.log(`UMDC  →  http://localhost:${PORT}`);
  console.log(`Admin →  http://localhost:${PORT}/admin`);
  if (ADMIN_PASSWORD === 'umdc') {
    console.log('\n⚠  Mot de passe admin par défaut « umdc ».');
    console.log('   Lance avec  UMDC_ADMIN_PASSWORD="ton-mot-de-passe" node server.js');
  }
});
