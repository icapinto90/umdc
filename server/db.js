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
    CREATE TABLE IF NOT EXISTS subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      consent_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
  `);

  const now = () => new Date().toISOString();
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

    addSubscriber(email) {
      const at = now();
      const r = db.prepare('INSERT OR IGNORE INTO subscribers (email, consent_at, created_at) VALUES (?, ?, ?)').run(email, at, at);
      return r.changes > 0;
    },
    listSubscribers(q = '') {
      const like = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
      return db.prepare("SELECT id, email, consent_at, created_at FROM subscribers WHERE email LIKE ? ESCAPE '\\' ORDER BY created_at DESC").all(like);
    },
    countSubscribers() {
      return db.prepare('SELECT COUNT(*) AS n FROM subscribers').get().n;
    },
    deleteSubscriber(id) {
      return db.prepare('DELETE FROM subscribers WHERE id = ?').run(id).changes > 0;
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
