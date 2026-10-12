import '../shared/tokens.css';
import '../shared/umdc-components.css';
import './styles.css';
import { Stage } from './scene.js';
import { Ambient } from './sound.js';
import { DEFAULT_CONTENT, publicContent } from '../../server/content.js';

/* ---------------------------------------------------------------- outils */

const $ = (sel, root = document) => root.querySelector(sel);
const pad2 = (n) => String(n).padStart(2, '0');
const fmtTime = (sec) => (Number.isFinite(sec) ? pad2(Math.floor(sec / 60)) + ':' + pad2(Math.floor(sec % 60)) : '00:00');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CONDOR_SAFE = /^[A-Za-z .\s]*$/;
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// h('div', { class: 'x', onClick: fn }, enfant, 'texte', …)
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

// Titre Condor ; si le texte a des signes que Condor ne contient pas (accents, chiffres…), il passe en mono.
const display = (text, level = 'm', tag = 'h2') =>
  h(tag, { class: `umdc-display umdc-display-${level}${CONDOR_SAFE.test(text) ? '' : ' umdc-display-fallback'}` }, text);

function button(label, { variant = 'primary', size = 'm', icon, onClick, type = 'button', id } = {}) {
  return h('button', { type, id, class: `umdc-btn umdc-btn-${variant} umdc-btn-${size}`, onClick },
    h('span', { class: 'umdc-btn-label' }, label),
    icon ? h('span', { class: 'umdc-btn-icon', 'aria-hidden': 'true' }, icon) : null);
}

const errorLine = (id, text) =>
  h('p', { id, class: 'umdc-field-error' }, h('span', { class: 'umdc-flag' }, '[!] ERREUR'), h('span', null, text));

/* ---------------------------------------------------------------- état */

const SECTIONS = ['accueil', 'reseaux', 'rejoindre', 'ecouter', 'confidentialite'];
const NAMES = { accueil: 'Accueil', reseaux: 'Réseaux', rejoindre: 'Rejoindre', ecouter: 'Écouter', confidentialite: 'Confidentialité' };

const app = {
  content: publicContent(DEFAULT_CONTENT),
  intro: true,
  phase: 'loading', // loading → panorama → unearth → ready
  section: 'accueil',
  _camSec: null,
  closing: false,
  progress: 0,
  modelReady: false,
  mouse: { x: 0, y: 0 },
  current: -1,
  playing: false,
  signup: { status: 'idle', email: '', consent: false, errors: {} },

  get released() { return this.content.release.released; },
  get tracks() { return this.content.tracks; },
  get trackCount() { return this.content.trackCount; },
  camSec() { return this._camSec || this.section; },
  isPlaying() { return this.released && this.playing && this.current >= 0; },

  onProgress(p) {
    const v = Math.max(0, Math.min(99, Math.round(p)));
    if (v > this.progress) { this.progress = v; renderIntro(); }
  },
  onModelReady() {
    if (this.modelReady) return;
    this.modelReady = true;
    clearTimeout(failTimer);
    this.progress = 100;
    renderIntro();
    if (this.intro) phaseTimer = setTimeout(startPanorama, 150);
    else setPhase('ready');
  },
  /* Un clic sur la cartouche : pendant le panorama elle se dégage, ensuite elle ouvre « Écouter ». */
  onCoverClick() {
    if (this.phase === 'panorama') startUnearth();
    else if (this.phase === 'ready' && this.section !== 'ecouter') go('ecouter');
  },
};

const sound = new Ambient();
const audio = $('#audio');
let stage = null;
let phaseTimer = null;
let goTimer = null;
let failTimer = null;

/* ---------------------------------------------------------------- intro */

function setPhase(phase) {
  app.phase = phase;
  renderChrome();
  renderIntro();
}

function startPanorama() {
  if (app.phase !== 'loading') return;
  setPhase('panorama');
  stage?.panorama();
}

/* Le déblayage : 2,4 s d'un seul mouvement ; le menu arrive pendant que la cartouche se pose. */
function startUnearth() {
  if (app.phase !== 'panorama') return;
  sound.whoosh();
  stage?.unearth();
  setPhase('unearth');
  clearTimeout(phaseTimer);
  phaseTimer = setTimeout(() => setPhase('ready'), 1700);
}

/* « Passer » joue le même geste, il est déjà court. */
function skipIntro() {
  if (app.phase === 'panorama') { startUnearth(); return; }
  clearTimeout(phaseTimer);
  stage?.skip();
  setPhase('ready');
}

function renderIntro() {
  const intro = $('#intro');
  const ph = app.phase;
  intro.className = 'intro ' + (ph === 'loading' ? 'is-loading' : ph === 'panorama' ? 'is-revealing' : 'is-done');
  $('#intro-bar').style.width = app.progress + '%';
  $('#intro-pct').textContent = app.progress + ' %';
  intro.inert = ph !== 'loading' && ph !== 'panorama';
}

/* ---------------------------------------------------------------- navigation */

/* Le panneau se retire en fondu avant que le suivant n'arrive ; la caméra part tout de suite. */
function go(s) {
  if (!SECTIONS.includes(s)) s = 'accueil';
  const cur = app.section;
  if (s === cur && !goTimer) return;
  sound.blip(s === 'accueil' ? 392 : 523);
  app._camSec = s === 'confidentialite' ? 'rejoindre' : s;
  stage?.navigate();
  clearTimeout(goTimer);
  if (cur !== 'accueil' && s !== cur) {
    app.closing = true;
    renderChrome();
    goTimer = setTimeout(() => { goTimer = null; app.closing = false; showSection(s); }, reducedMotion() ? 0 : 420);
  } else {
    goTimer = null;
    app.closing = false;
    showSection(s);
  }
}

function showSection(s) {
  app.section = s;
  if (s !== 'rejoindre') app.signup.errors = {};
  renderChrome();
  renderPanel();
  if (s !== 'accueil') $('#umdc-panel .back')?.focus({ preventScroll: true });
}

const toggle = (s) => go(app.section === s ? 'accueil' : s);

function renderChrome() {
  const sec = app.section;
  const uiOn = !app.intro || app.phase === 'ready';
  const hudOn = !app.intro || app.phase !== 'loading';
  const root = $('#site');
  root.classList.toggle('is-home', sec === 'accueil');
  root.classList.toggle('has-panel', sec !== 'accueil');
  root.classList.toggle('ui-on', uiOn);
  root.classList.toggle('hud-on', hudOn);
  for (const b of document.querySelectorAll('.nav-item')) {
    const on = b.dataset.go === sec;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  $('.nav').inert = !uiOn;
  $('#hint').hidden = !(app.intro && app.phase === 'panorama');
  $('#home').hidden = sec !== 'accueil';
  $('#home').inert = !uiOn;
  const panel = $('#umdc-panel');
  panel.hidden = sec === 'accueil';
  panel.classList.toggle('is-closing', app.closing);
  panel.setAttribute('aria-label', NAMES[sec]);
}

/* ---------------------------------------------------------------- panneaux */

function renderPanel() {
  const body = $('#panel-body');
  const sec = app.section;
  body.replaceChildren();
  if (sec === 'accueil') return;
  const view = { reseaux: viewReseaux, rejoindre: viewRejoindre, ecouter: viewEcouter, confidentialite: viewPrivacy }[sec]();
  body.append(h('div', { class: 'rise panel-body' }, view));
}

function viewReseaux() {
  const c = app.content.reseaux;
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      c.kicker ? h('span', { class: 'micro accent' }, c.kicker) : null,
      display(c.title),
      c.text ? h('p', { class: 'card-text' }, c.text) : null),
    app.content.socials.length
      ? h('ul', { class: 'nets' }, app.content.socials.map((n) => h('li', null,
        h('a', { class: 'net', href: n.url, target: '_blank', rel: 'noopener noreferrer' },
          h('span', { class: 'net-name' }, n.name),
          h('span', { class: 'net-handle' }, n.handle),
          h('span', { class: 'arr', 'aria-hidden': 'true' }, '↗'),
          h('span', { class: 'umdc-sr' }, ", s'ouvre dans un nouvel onglet")))))
      : null,
    c.footnote ? h('p', { class: 'micro muted', style: 'margin:0' }, c.footnote) : null);
}

function viewRejoindre() {
  const c = app.content.newsletter;
  const st = app.signup;
  if (st.status === 'success') {
    return h('section', { class: 'umdc-signup', 'aria-live': 'polite' },
      h('div', { class: 'umdc-signup-done' },
        h('span', { class: 'umdc-tag umdc-tag-solid' }, '[OK] INSCRIPTION ENVOYÉE'),
        display(c.successTitle),
        h('p', { class: 'umdc-signup-desc' }, c.successText)));
  }

  const emailErr = st.errors.email, consentErr = st.errors.consent;
  const input = h('input', {
    id: 'nl-email', class: 'umdc-input', type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email',
    placeholder: c.placeholder, 'aria-invalid': emailErr ? 'true' : null, 'aria-describedby': emailErr ? 'nl-email-err' : null,
    onInput: (e) => { st.email = e.target.value; },
  });
  input.value = st.email;
  const check = h('input', {
    type: 'checkbox', id: 'nl-consent', class: 'umdc-check-input', name: 'consent',
    'aria-invalid': consentErr ? 'true' : null, 'aria-describedby': consentErr ? 'nl-consent-err' : null,
    onChange: (e) => { st.consent = e.target.checked; },
  });
  check.checked = st.consent;
  const submitting = st.status === 'submitting';
  const submit = h('button', { type: 'submit', class: `umdc-btn umdc-btn-primary umdc-btn-m${submitting ? ' is-loading' : ''}`, disabled: submitting, 'aria-busy': submitting ? 'true' : null },
    h('span', { class: 'umdc-btn-label' }, c.button),
    submitting
      ? h('span', { class: 'umdc-loader', role: 'status' }, h('span', { class: 'umdc-sr' }, 'Envoi en cours'))
      : h('span', { class: 'umdc-btn-icon', 'aria-hidden': 'true' }, '→'));

  return h('section', { class: 'umdc-signup', 'aria-live': 'polite' },
    h('div', { class: 'umdc-signup-head' },
      display(c.title),
      c.text ? h('p', { class: 'umdc-signup-desc' }, c.text) : null),
    h('form', { class: 'umdc-signup-form', novalidate: true, onSubmit: submitSignup },
      h('div', { class: 'umdc-signup-row' },
        h('div', { class: `umdc-field umdc-signup-field${emailErr ? ' is-error' : ''}` },
          h('label', { for: 'nl-email', class: 'umdc-field-label' }, c.emailLabel),
          input,
          emailErr ? errorLine('nl-email-err', emailErr) : null),
        submit),
      h('div', { class: `umdc-check${consentErr ? ' is-error' : ''}` },
        check,
        h('label', { for: 'nl-consent', class: 'umdc-check-label' },
          h('span', { class: 'umdc-check-box', 'aria-hidden': 'true' }),
          h('span', { class: 'umdc-check-text' }, c.consent, ' ',
            h('button', { type: 'button', class: 'link-btn', onClick: (e) => { e.preventDefault(); go('confidentialite'); } }, app.content.privacy.title))),
        consentErr ? errorLine('nl-consent-err', consentErr) : null),
      // Pot de miel : invisible pour les gens, rempli par les robots.
      h('div', { class: 'hp', 'aria-hidden': 'true' },
        h('label', { for: 'nl-website' }, 'Site web'),
        h('input', { id: 'nl-website', name: 'website', tabindex: '-1', autocomplete: 'off' })),
      st.status === 'error'
        ? h('p', { class: 'umdc-field-error umdc-signup-server', role: 'alert' },
          h('span', { class: 'umdc-flag' }, '[!] ERREUR'), h('span', null, st.serverError || "Ça n'a pas marché. Réessaie dans un instant."))
        : null));
}

async function submitSignup(e) {
  e.preventDefault();
  const st = app.signup;
  const form = e.currentTarget;
  st.email = form.email.value.trim();
  st.consent = form.consent.checked;
  const errors = {};
  if (!EMAIL_RE.test(st.email)) errors.email = 'Cette adresse ne passe pas. Vérifie-la.';
  if (!st.consent) errors.consent = 'Coche la case pour recevoir la newsletter.';
  st.errors = errors;
  if (Object.keys(errors).length) {
    st.status = 'idle';
    renderPanel();
    $(errors.email ? '#nl-email' : '#nl-consent')?.focus();
    return;
  }
  sound.blip(784);
  st.status = 'submitting';
  renderPanel();
  try {
    const res = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: st.email, consent: true, website: form.website.value }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(res.status === 429 ? 'Trop de tentatives. Réessaie dans quelques minutes.' : data.error || '');
    }
    st.status = 'success';
  } catch (err) {
    st.status = 'error';
    st.serverError = err.message || '';
  }
  if (app.section === 'rejoindre') renderPanel();
}

function viewPrivacy() {
  const c = app.content.privacy;
  return h('div', { class: 'card tight' },
    h('div', { class: 'card-head' },
      display(c.title),
      h('p', { class: 'card-text' }, c.text)),
    h('div', { class: 'actions-end' }, button(app.content.nav.rejoindre, { variant: 'secondary', icon: '→', onClick: () => go('rejoindre') })));
}

function viewEcouter() {
  const c = app.content.ecouter;
  const released = app.released;
  const card = h('div', { class: 'card tight' },
    h('div', { class: 'card-head' },
      display(released ? c.releasedTitle : c.title),
      h('p', { class: 'card-text' }, released ? c.releasedText : c.text)));

  if (!released) {
    const widths = ['62%', '44%', '71%', '38%', '56%', '49%', '66%', '41%'];
    card.append(
      h('div', { class: 'ghost', 'aria-hidden': 'true' },
        h('div', { class: 'ghost-list' }, widths.map((w) => h('div', { class: 'ghost-row' },
          h('span', { class: 'ghost-num' }), h('span', { class: 'ghost-bar', style: `width:${w}` }), h('span', { class: 'ghost-dur' })))),
        h('span', { class: 'ghost-label micro' }, app.content.release.coverLabel || 'Prochainement')),
      h('div', { class: 'actions-end' }, button(c.notifyCta, { variant: 'secondary', icon: '→', onClick: () => go('rejoindre') })));
    return card;
  }

  const playable = app.tracks.some((t) => t.src);
  if (playable) {
    card.append(h('div', { class: 'player' },
      h('div', { class: 'player-info' },
        h('span', { class: 'micro muted', id: 'pl-status' }),
        h('span', { class: 'player-line', id: 'pl-line' }),
        h('div', { class: 'progress', 'aria-hidden': 'true' }, h('span', { id: 'pl-bar' }))),
      h('span', { class: 'player-time', id: 'pl-time' }, '00:00'),
      button('Lecture', { variant: 'secondary', size: 's', id: 'pl-toggle', onClick: togglePlay })));
  }

  card.append(h('div', { class: 'umdc-tracklist' },
    h('ol', { class: 'umdc-tracklist-list' }, app.tracks.map((t, i) => h('li', { class: 'umdc-track-item' },
      h('button', { type: 'button', class: 'umdc-track', 'data-i': i, disabled: !t.src, onClick: () => selectTrack(i) },
        h('span', { class: 'umdc-track-num' }, pad2(i + 1)),
        h('span', { class: 'umdc-track-title' }, t.title, t.feat ? h('span', { class: 'umdc-track-feat' }, 'feat. ', t.feat) : null),
        h('span', { class: 'umdc-track-tag' }),
        h('span', { class: 'umdc-track-dur' }, t.duration || '--:--')))))));

  if (app.content.platforms.length) {
    card.append(h('div', { class: 'card-head', style: 'gap:8px' },
      h('span', { class: 'micro accent' }, c.platformsTitle),
      h('ul', { class: 'nets small' }, app.content.platforms.map((p) => h('li', null,
        h('a', { class: 'net', href: p.url, target: '_blank', rel: 'noopener noreferrer' },
          h('span', { class: 'net-name' }, p.name),
          h('span', null),
          h('span', { class: 'arr', 'aria-hidden': 'true' }, '↗'),
          h('span', { class: 'umdc-sr' }, ", s'ouvre dans un nouvel onglet")))))));
  }
  queueMicrotask(renderPlayer);
  return card;
}

/* ---------------------------------------------------------------- lecteur */

function selectTrack(i) {
  const t = app.tracks[i];
  if (!t || !t.src) return;
  if (i === app.current) { togglePlay(); return; }
  sound.blip(659);
  app.current = i;
  audio.src = t.src;
  audio.play().catch(() => { app.playing = false; renderPlayer(); });
  app.playing = true;
  renderPlayer();
}

function togglePlay() {
  if (app.current < 0) {
    const first = app.tracks.findIndex((t) => t.src);
    if (first >= 0) selectTrack(first);
    return;
  }
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

function nextTrack() {
  for (let i = app.current + 1; i < app.tracks.length; i++) if (app.tracks[i].src) { selectTrack(i); return; }
  app.playing = false;
  renderPlayer();
}

audio.addEventListener('play', () => { app.playing = true; sound.duck(true); renderPlayer(); });
audio.addEventListener('pause', () => { app.playing = false; sound.duck(false); renderPlayer(); });
audio.addEventListener('ended', nextTrack);
audio.addEventListener('timeupdate', renderTime);
audio.addEventListener('error', () => { if (audio.src) { app.playing = false; renderPlayer(); } });

function renderTime() {
  const t = $('#pl-time');
  if (t) t.textContent = fmtTime(audio.currentTime || 0);
  const bar = $('#pl-bar');
  if (bar) bar.style.width = audio.duration ? (100 * audio.currentTime / audio.duration).toFixed(2) + '%' : '0';
}

function renderPlayer() {
  const ct = app.current >= 0 ? app.tracks[app.current] : null;
  const status = $('#pl-status');
  if (status) status.textContent = !ct ? 'Choisis un titre' : app.playing ? 'En lecture' : 'En pause';
  const line = $('#pl-line');
  if (line) line.textContent = ct ? pad2(app.current + 1) + '  ' + ct.title + (ct.feat ? ' feat. ' + ct.feat : '') : '—';
  const btn = $('#pl-toggle .umdc-btn-label');
  if (btn) btn.textContent = app.playing && ct ? 'Pause' : 'Lecture';
  for (const b of document.querySelectorAll('.umdc-track[data-i]')) {
    const i = Number(b.dataset.i), on = i === app.current;
    b.classList.toggle('is-current', on);
    if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    b.querySelector('.umdc-track-num').textContent = on ? '→' : pad2(i + 1);
  }
  renderTime();
}

/* ---------------------------------------------------------------- contenu */

function applyTexts() {
  for (const el of document.querySelectorAll('[data-text]')) {
    const [sec, key] = el.dataset.text.split('.');
    const v = app.content[sec]?.[key];
    if (typeof v === 'string') el.textContent = v;
  }
}

let releaseTimer = null;
async function loadContent() {
  try {
    const res = await fetch('/api/site', { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const wasReleased = app.released;
    app.content = await res.json();
    applyTexts();
    if (app.released !== wasReleased) { audio.pause(); app.current = -1; }
    if (app.section !== 'accueil' && app.section !== 'rejoindre') renderPanel();
    // À l'heure de la sortie, la page ouverte se met à jour toute seule.
    clearTimeout(releaseTimer);
    const at = Date.parse(app.content.release.opensAt || '');
    if (Number.isFinite(at)) {
      const wait = at - Date.now() + 1500;
      if (wait > 0 && wait < 2 ** 31 - 1) releaseTimer = setTimeout(loadContent, wait);
    }
  } catch (e) {
    // Pas d'API : on garde les textes par défaut du design.
  }
}

/* ---------------------------------------------------------------- démarrage */

function init() {
  const root = $('#site');
  root.addEventListener('pointermove', (e) => {
    const r = root.getBoundingClientRect();
    if (!r.width || !r.height) return;
    app.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    app.mouse.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
  });
  root.addEventListener('pointerleave', () => { app.mouse.x = 0; app.mouse.y = 0; });

  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-go]');
    if (!target) return;
    const s = target.dataset.go;
    if (target.classList.contains('nav-item')) toggle(s); else go(s);
  });
  // Le son est allumé à l'arrivée ; la musique part au premier clic (ou toucher, ou touche) n'importe où sur la page,
  // le navigateur n'autorisant le son qu'après un geste. Le bouton Son garde la main : il ne déclenche pas ce départ.
  const showSound = (on) => {
    $('#sound').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('#sound-label').textContent = on ? 'on' : 'off';
  };
  sound.on = true;
  showSound(true);
  sound.startOnFirstGesture((e) => !!(e.target && e.target.closest && e.target.closest('#sound')));
  $('#sound').addEventListener('click', () => showSound(sound.toggle()));
  $('#unearth').addEventListener('click', startUnearth);
  $('#skip').addEventListener('click', skipIntro);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && app.section !== 'accueil') go('accueil');
  });

  renderChrome();
  renderIntro();
  loadContent();

  try {
    stage = new Stage($('#stage'), app);
  } catch (e) {
    console.error(e);
    app.onModelReady(true);
  }
  // Si le modèle traîne trop, on ouvre quand même le site.
  failTimer = setTimeout(() => app.onModelReady(true), 25000);
}

init();
