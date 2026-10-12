import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_CONTENT, sanitizeContent } from './content.js';

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'umdc.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS content (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS phones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL UNIQUE,
      consent_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
  `);

  const now = () => new Date().toISOString();

  /* Passage des emails aux numéros (une seule fois) : l'ancienne liste d'emails est supprimée, et les textes enregistrés
     qui parlaient d'e-mail reprennent les nouveaux textes (SMS). */
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'subscribers'").get()) {
    db.exec('DROP TABLE subscribers');
    const row = db.prepare('SELECT json FROM content WHERE id = 1').get();
    if (row) {
      try {
        const c = JSON.parse(row.json);
        for (const [sec, keys] of [['newsletter', ['text', 'consent']], ['privacy', ['text']]]) {
          for (const k of keys) if (c[sec] && /mail|@/i.test(c[sec][k] || '')) c[sec][k] = DEFAULT_CONTENT[sec][k];
        }
        db.prepare('UPDATE content SET json = ? WHERE id = 1').run(JSON.stringify(c));
      } catch { /* contenu illisible : on n'y touche pas */ }
    }
  }
  const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

  const getContentStmt = db.prepare('SELECT json, updated_at FROM content WHERE id = 1');
  const putContentStmt = db.prepare(
    'INSERT INTO content (id, json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at'
  );

  return {
    getContent() {
      const row = getContentStmt.get();
      if (!row) return { content: sanitizeContent(DEFAULT_CONTENT), updatedAt: null };
      let parsed = {};
      try { parsed = JSON.parse(row.json); } catch { /* contenu illisible : on repart des défauts */ }
      return { content: sanitizeContent(parsed), updatedAt: row.updated_at };
    },
    saveContent(content) {
      const at = now();
      putContentStmt.run(JSON.stringify(content), at);
      return at;
    },

    addSubscriber(phone) {
      const at = now();
      const r = db.prepare('INSERT OR IGNORE INTO phones (phone, consent_at, created_at) VALUES (?, ?, ?)').run(phone, at, at);
      return r.changes > 0;
    },
    // la recherche ne regarde que les chiffres : « 079 123 » trouve +41791234567
    listSubscribers(q = '') {
      let digits = q.replace(/\D/g, '');
      if (digits.startsWith('0') && !digits.startsWith('00')) digits = digits.slice(1);
      return db.prepare("SELECT id, phone, consent_at, created_at FROM phones WHERE phone LIKE ? ORDER BY created_at DESC").all('%' + digits + '%');
    },
    countSubscribers() {
      return db.prepare('SELECT COUNT(*) AS n FROM phones').get().n;
    },
    deleteSubscriber(id) {
      return db.prepare('DELETE FROM phones WHERE id = ?').run(id).changes > 0;
    },

    createSession(ttlMs) {
      const token = crypto.randomBytes(32).toString('base64url');
      db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
      db.prepare('INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)').run(hash(token), Date.now() + ttlMs);
      return token;
    },
    hasSession(token) {
      if (!token) return false;
      const row = db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(hash(token));
      return Boolean(row && row.expires_at > Date.now());
    },
    deleteSession(token) {
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
    },
  };
}
