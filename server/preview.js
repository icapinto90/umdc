// Les extraits : le public n'entend jamais un titre en entier. Pour chaque titre, ffmpeg découpe 30 s à partir
// du début choisi dans l'admin (0:00 par défaut), avec un fondu d'entrée et de sortie, et seul cet extrait est servi.
// Les extraits sont gardés dans <DATA_DIR>/audio/extraits/ et refaits si le fichier ou le point de départ change.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const PREVIEW_SECONDS = 30;
const FADE_IN = 0.4;
const FADE_OUT = 2;

const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: 120000 }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stdout)));
});

/* « 1:12 » → 72 secondes. */
export function parseStart(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

export function previewDir(audioDir) {
  return path.join(audioDir, 'extraits');
}

function previewFile(audioDir, audio, start) {
  return path.join(previewDir(audioDir), `${path.parse(audio).name}--${start}.m4a`);
}

const pending = new Map();

/* Renvoie le chemin de l'extrait, en le fabriquant s'il n'existe pas encore. */
export function ensurePreview(audioDir, audio, startText) {
  const src = path.join(audioDir, audio);
  const start = parseStart(startText);
  const out = previewFile(audioDir, audio, start);
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs) return Promise.resolve(out);
  if (pending.has(out)) return pending.get(out);
  const job = (async () => {
    fs.mkdirSync(previewDir(audioDir), { recursive: true });
    const total = Number(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src])) || 0;
    // un départ trop proche de la fin : on recule pour garder un extrait entier
    let from = start;
    if (total && from + PREVIEW_SECONDS > total) from = Math.max(0, total - PREVIEW_SECONDS);
    const len = total ? Math.min(PREVIEW_SECONDS, total - from) : PREVIEW_SECONDS;
    const tmp = out + '.tmp.m4a';
    await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(from), '-t', String(len), '-i', src, '-vn',
      '-af', `afade=t=in:st=0:d=${FADE_IN},afade=t=out:st=${Math.max(0, len - FADE_OUT).toFixed(2)}:d=${FADE_OUT}`,
      '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', tmp]);
    fs.renameSync(tmp, out);
    return out;
  })().finally(() => pending.delete(out));
  pending.set(out, job);
  return job;
}

/* Prépare à l'avance les extraits des titres en ligne (après un enregistrement de l'admin), et efface les vieux. */
export function warmPreviews(audioDir, tracks) {
  const keep = new Set();
  for (const t of tracks) {
    if (!t.audio || !fs.existsSync(path.join(audioDir, t.audio))) continue;
    keep.add(path.basename(previewFile(audioDir, t.audio, parseStart(t.previewStart))));
    ensurePreview(audioDir, t.audio, t.previewStart).catch((e) => console.warn('[umdc] extrait impossible pour', t.audio, '—', e.message));
  }
  const dir = previewDir(audioDir);
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) if (!keep.has(f) && !f.endsWith('.tmp.m4a')) fs.rmSync(path.join(dir, f), { force: true });
}
