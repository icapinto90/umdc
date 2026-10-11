import '../shared/tokens.css';
import '../shared/umdc-components.css';
import './admin.css';

/* ---------------------------------------------------------------- outils */

const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const btn = (label, { variant = 'secondary', size = 'm', onClick, type = 'button', icon, disabled, inverse } = {}) =>
  h('button', { type, class: `umdc-btn umdc-btn-${variant} umdc-btn-${size}${inverse ? ' umdc-btn-inverse' : ''}`, onClick, disabled },
    h('span', { class: 'umdc-btn-label' }, label), icon ? h('span', { class: 'umdc-btn-icon', 'aria-hidden': 'true' }, icon) : null);

let uid = 0;
function field(label, value, onInput, { type = 'text', multiline = false, placeholder, help, wide = false } = {}) {
  const id = 'f' + ++uid;
  const input = multiline
    ? h('textarea', { id, class: 'adm-textarea', placeholder, onInput: (e) => onInput(e.target.value) })
    : h('input', { id, type, class: 'umdc-input', placeholder, onInput: (e) => onInput(e.target.value) });
  input.value = value ?? '';
  return h('div', { class: 'umdc-field' + (wide ? ' wide' : '') },
    h('label', { for: id, class: 'umdc-field-label' }, label),
    input,
    help ? h('p', { class: 'umdc-field-help' }, help) : null);
}

function checkbox(label, checked, onChange) {
  const id = 'c' + ++uid;
  return h('div', { class: 'umdc-check' },
    h('input', { type: 'checkbox', id, class: 'umdc-check-input', checked, onChange: (e) => onChange(e.target.checked) }),
    h('label', { for: id, class: 'umdc-check-label' }, h('span', { class: 'umdc-check-box', 'aria-hidden': 'true' }), h('span', null, label)));
}

const section = (title, intro, ...body) =>
  h('section', { class: 'adm-section' }, h('header', null, h('h2', null, title), intro ? h('p', null, intro) : null), ...body);

const fmtSize = (n) => (n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' Mo' : Math.round(n / 1024) + ' Ko');
const fmtDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
};
// datetime-local ⇄ ISO (heure locale du navigateur)
const isoToLocal = (iso) => {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const localToIso = (v) => (v ? new Date(v).toISOString() : '');

let toastTimer;
function toast(msg, err = false) {
  $('.toast')?.remove();
  document.body.append(h('div', { class: 'toast' + (err ? ' err' : ''), role: err ? 'alert' : 'status' }, msg));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('.toast')?.remove(), 3200);
}

async function api(path, { method = 'GET', body, raw } = {}) {
  const headers = { 'X-UMDC-Admin': '1' };
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  const res = await fetch('/api' + path, { method, headers, body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/admin/login') { state.authed = false; render(); throw new Error('Session expirée.'); }
  if (!res.ok) throw new Error(data.error || 'Erreur ' + res.status);
  return data;
}

/* ---------------------------------------------------------------- état */

const TABS = [
  ['textes', 'Textes'],
  ['reseaux', 'Réseaux'],
  ['sortie', 'Sortie & tracklist'],
  ['sons', 'Sons'],
  ['emails', 'Emails'],
];

const state = {
  authed: false,
  tab: (location.hash.slice(1) && TABS.some(([k]) => k === location.hash.slice(1))) ? location.hash.slice(1) : 'textes',
  content: null,
  saved: '',
  updatedAt: null,
  released: false,
  saving: false,
  files: [],
  subs: [],
  subsTotal: 0,
  q: '',
};

const dirty = () => state.content && JSON.stringify(state.content) !== state.saved;
function touch() { renderSavebar(); }

window.addEventListener('beforeunload', (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });

/* ---------------------------------------------------------------- rendu */

function render() {
  const root = $('#app');
  root.replaceChildren(state.authed && state.content ? viewApp() : viewLogin());
}

function viewLogin() {
  let pwd = '';
  const err = h('p', { class: 'umdc-field-error', role: 'alert', hidden: true });
  return h('main', { class: 'login' },
    h('div', { class: 'login-card' },
      h('img', { src: '/assets/logo-umdc.png', alt: 'UMDC' }),
      h('h1', { class: 'micro', style: 'margin:0' }, 'Back-office'),
      h('form', {
        onSubmit: async (e) => {
          e.preventDefault();
          err.hidden = true;
          try {
            await api('/admin/login', { method: 'POST', body: { password: pwd } });
            state.authed = true;
            await loadAll();
          } catch (ex) {
            err.replaceChildren(h('span', { class: 'umdc-flag' }, '[!] ERREUR'), h('span', null, ex.message));
            err.hidden = false;
          }
        },
      },
      field('Mot de passe', '', (v) => { pwd = v; }, { type: 'password' }),
      err,
      btn('Entrer', { variant: 'primary', type: 'submit', icon: '→' }))));
}

function viewApp() {
  const main = h('main', { class: 'adm-main', id: 'main' });
  const wrap = h('div', null,
    h('header', { class: 'adm-head' },
      h('img', { src: '/assets/mark-umdc.png', alt: 'UMDC' }),
      h('span', { class: 'micro' }, 'Back-office'),
      h('span', { class: 'micro status-pill' + (state.released ? ' on' : ''), id: 'rel-pill' }, state.released ? 'Album sorti' : 'Avant la sortie'),
      h('span', { class: 'spacer' }),
      h('a', { class: 'micro', href: '/', target: '_blank', rel: 'noopener' }, 'Voir le site ↗'),
      btn('Déconnexion', { variant: 'ghost', size: 's', inverse: true, onClick: logout })),
    h('nav', { class: 'adm-tabs', role: 'tablist', 'aria-label': 'Rubriques' },
      TABS.map(([k, label]) => h('button', {
        type: 'button', role: 'tab', class: 'adm-tab', 'aria-selected': state.tab === k ? 'true' : 'false',
        onClick: () => { state.tab = k; history.replaceState(null, '', '#' + k); render(); if (k === 'emails') loadSubs(); if (k === 'sons') loadFiles(); },
      }, label))),
    main,
    h('div', { class: 'savebar', id: 'savebar' }));
  const view = { textes: viewTextes, reseaux: viewReseaux, sortie: viewSortie, sons: viewSons, emails: viewEmails }[state.tab];
  main.append(...[].concat(view()));
  queueMicrotask(renderSavebar);
  return wrap;
}

function renderSavebar() {
  const bar = $('#savebar');
  if (!bar) return;
  const d = dirty();
  bar.hidden = state.tab === 'emails' && !d;
  bar.replaceChildren(
    h('span', { class: 'msg' + (d ? ' dirty' : '') }, d ? 'Modifications non enregistrées' : state.updatedAt ? 'Enregistré · ' + fmtDate(state.updatedAt) : 'Contenu par défaut du design'),
    d ? btn('Annuler', { variant: 'ghost', onClick: () => { state.content = JSON.parse(state.saved); render(); } }) : null,
    btn(state.saving ? 'Enregistrement…' : 'Enregistrer', { variant: 'primary', onClick: save, disabled: !d || state.saving }));
}

/* ---------- Textes ---------- */

function bind(sec, key) {
  return [state.content[sec][key], (v) => { state.content[sec][key] = v; touch(); }];
}
const f = (label, sec, key, opts) => field(label, ...bind(sec, key), opts);

function viewTextes() {
  return [
    section('Accueil', "Le texte sous la cartouche, le bouton d'entrée et l'invitation à dégager la cartouche pendant l'intro.",
      h('div', { class: 'grid-2' },
        f("Nom de l'artiste (sous le logo)", 'home', 'artist', { wide: true }),
        f('Surtitre', 'home', 'kicker'),
        f('Bouton', 'home', 'cta'),
        f('Texte', 'home', 'text', { multiline: true, wide: true }),
        f("Bouton d'entrée (fin du chargement, lance la musique)", 'home', 'enter'),
        f("Bouton pour dégager la cartouche (pendant l'intro)", 'home', 'hintCta'),
        f('Indication en bas à droite', 'home', 'dragHint', { wide: true }))),
    section('Menu', null,
      h('div', { class: 'grid-2' },
        f('Réseaux', 'nav', 'reseaux'), f('Rejoindre', 'nav', 'rejoindre'), f('Écouter', 'nav', 'ecouter'))),
    section('Panneau Réseaux', 'Les liens eux-mêmes se gèrent dans l’onglet Réseaux.',
      h('div', { class: 'grid-2' },
        f('Surtitre', 'reseaux', 'kicker'), f('Titre', 'reseaux', 'title'),
        f('Texte', 'reseaux', 'text', { multiline: true, wide: true }),
        f('Note de bas', 'reseaux', 'footnote', { wide: true }))),
    section('Panneau Rejoindre (newsletter)', null,
      h('div', { class: 'grid-2' },
        f('Titre', 'newsletter', 'title'), f('Bouton', 'newsletter', 'button'),
        f('Texte', 'newsletter', 'text', { multiline: true, wide: true }),
        f('Libellé du champ', 'newsletter', 'emailLabel'), f('Exemple dans le champ', 'newsletter', 'placeholder'),
        f('Case de consentement', 'newsletter', 'consent', { multiline: true, wide: true }),
        f('Titre après inscription', 'newsletter', 'successTitle'),
        f('Texte après inscription', 'newsletter', 'successText', { wide: true }))),
    section('Confidentialité', 'Ouvert depuis le lien de la case de consentement.',
      h('div', { class: 'grid-2' },
        f('Titre', 'privacy', 'title', { wide: true }),
        f('Texte', 'privacy', 'text', { multiline: true, wide: true }))),
    section('Panneau Écouter', null,
      h('div', { class: 'grid-2' },
        f('Titre avant la sortie', 'ecouter', 'title'), f('Bouton avant la sortie', 'ecouter', 'notifyCta'),
        f('Texte avant la sortie', 'ecouter', 'text', { multiline: true, wide: true }),
        f('Titre après la sortie', 'ecouter', 'releasedTitle'), f('Titre des plateformes', 'ecouter', 'platformsTitle'),
        f('Texte après la sortie', 'ecouter', 'releasedText', { wide: true }))),
  ];
}

/* ---------- listes ---------- */

function editableList(key, columns, makeItem, { addLabel, extra } = {}) {
  const list = state.content[key];
  const rows = h('div', { class: 'rows' });
  const redraw = () => rows.replaceChildren(...list.map((item, i) => row(item, i)));
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; touch(); redraw(); };
  const row = (item, i) => h('div', { class: 'row ' + key },
    key === 'tracks' ? h('span', { class: 'num' }, String(i + 1).padStart(2, '0')) : null,
    columns(item, i),
    h('div', { class: 'row-tools' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Monter', disabled: i === 0, onClick: () => move(i, -1) }, '↑'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Descendre', disabled: i === list.length - 1, onClick: () => move(i, 1) }, '↓'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Supprimer', onClick: () => { list.splice(i, 1); touch(); redraw(); } }, '×')));
  redraw();
  return [rows, h('div', { class: 'list-foot' },
    btn(addLabel || 'Ajouter', { icon: '+', onClick: () => { list.push(makeItem()); touch(); redraw(); rows.lastElementChild?.querySelector('input')?.focus(); } }),
    extra || null)];
}

const itemField = (label, item, key, opts) => field(label, item[key], (v) => { item[key] = v; touch(); }, opts);

function viewReseaux() {
  return section('Réseaux', 'Un réseau sans URL ne s’affiche pas. L’ordre ici est celui du site.',
    ...editableList('socials', (item) => [
      itemField('Nom', item, 'name'),
      itemField('Compte', item, 'handle', { placeholder: '@umdc' }),
      itemField('URL', item, 'url', { type: 'url', placeholder: 'https://' }),
    ], () => ({ id: '', name: '', handle: '', url: '' }), { addLabel: 'Ajouter un réseau' }));
}

/* ---------- Sortie & tracklist ---------- */

function viewSortie() {
  const r = state.content.release;
  const mode = (value, title, text) => h('label', { class: 'radio' },
    h('input', { type: 'radio', name: 'mode', value, checked: r.mode === value, onChange: () => { r.mode = value; touch(); } }),
    h('span', null, h('strong', null, title), ' — ', text));
  const dateField = field('Date et heure de sortie (heure locale)', isoToLocal(r.date), (v) => { r.date = localToIso(v); touch(); }, { type: 'datetime-local' });

  const options = () => [h('option', { value: '' }, '— aucun son —'), ...state.files.map((fl) => h('option', { value: fl.name }, fl.name))];
  const audioSelect = (item) => {
    const id = 'a' + ++uid;
    const sel = h('select', {
      id, class: 'adm-select',
      onChange: (e) => {
        item.audio = e.target.value;
        touch();
        if (item.audio && !item.duration) fillDuration(item, sel.closest('.row'));
      },
    }, options());
    if (item.audio && !state.files.some((fl) => fl.name === item.audio)) sel.append(h('option', { value: item.audio }, item.audio + ' (introuvable)'));
    sel.value = item.audio || '';
    return h('div', { class: 'umdc-field' }, h('label', { for: id, class: 'umdc-field-label' }, 'Son'), sel);
  };

  return [
    section('Sortie', "Avant la sortie, le site ne montre ni les titres, ni les sons, ni les plateformes — même à qui fouille dans le code de la page.",
      h('fieldset', { class: 'radios' },
        h('legend', { class: 'micro' }, 'Ouverture de « Écouter »'),
        mode('auto', 'Automatique', 's’ouvre tout seul à la date indiquée ; une page déjà ouverte se met à jour.'),
        mode('on', 'Forcer l’ouverture', 'pour tester ou sortir en avance.'),
        mode('off', 'Forcer la fermeture', 'reste fermé quoi qu’il arrive.')),
      h('div', { class: 'grid-2' },
        dateField,
        h('div'),
        f('Mention sur la tracklist floue, avant la sortie', 'release', 'coverLabel'))),
    section('Plateformes', 'Affichées dans « Écouter » après la sortie. Une plateforme sans URL n’apparaît pas.',
      ...editableList('platforms', (item) => [
        itemField('Nom', item, 'name'),
        itemField("URL de l'album", item, 'url', { type: 'url', placeholder: 'https://' }),
      ], () => ({ id: '', name: '', url: '' }), { addLabel: 'Ajouter une plateforme' })),
    section('Tracklist', 'Choisis le son de chaque titre (envoie les fichiers dans l’onglet Sons). Décoche « en ligne » pour cacher un titre.',
      ...editableList('tracks', (item) => [
        itemField('Titre', item, 'title'),
        itemField('Feat.', item, 'feat'),
        itemField('Durée', item, 'duration', { placeholder: '03:42' }),
        audioSelect(item),
        checkbox('En ligne', item.enabled, (v) => { item.enabled = v; touch(); }),
      ], () => ({ id: '', title: '', feat: '', duration: '', audio: '', enabled: true }), { addLabel: 'Ajouter un titre' })),
  ];
}

// Lit la durée du fichier choisi et remplit le champ « Durée » s'il est vide.
function fillDuration(item, row) {
  const probe = new Audio();
  probe.preload = 'metadata';
  probe.addEventListener('loadedmetadata', () => {
    if (!Number.isFinite(probe.duration) || item.duration) return;
    const d = Math.round(probe.duration);
    item.duration = String(Math.floor(d / 60)).padStart(2, '0') + ':' + String(d % 60).padStart(2, '0');
    const input = row?.querySelectorAll('input')[2];
    if (input) input.value = item.duration;
    touch();
  }, { once: true });
  probe.src = previewUrl(item.audio);
}

/* ---------- Sons ---------- */

function viewSons() {
  const input = h('input', { type: 'file', id: 'audio-input', accept: '.mp3,.m4a,.aac,.ogg,.wav,.flac,audio/*', multiple: true, hidden: true, onChange: (e) => uploadFiles(e.target.files) });
  const drop = h('div', {
    class: 'drop',
    onDragover: (e) => { e.preventDefault(); drop.classList.add('is-over'); },
    onDragleave: () => drop.classList.remove('is-over'),
    onDrop: (e) => { e.preventDefault(); drop.classList.remove('is-over'); uploadFiles(e.dataTransfer.files); },
  },
  h('span', { class: 'micro' }, 'Dépose tes fichiers ici'),
  h('span', { class: 'muted', style: 'font-size:13px' }, 'mp3, m4a, aac, ogg, wav, flac — 60 Mo max chacun'),
  btn('Choisir des fichiers', { icon: '+', onClick: () => input.click() }),
  input);

  const used = new Map(state.content.tracks.filter((t) => t.audio).map((t) => [t.audio, t.title]));
  const list = state.files.length
    ? h('ul', { class: 'files' }, state.files.map((fl) => h('li', null,
      h('span', { class: 'name', title: fl.name }, fl.name, used.has(fl.name) ? h('span', { class: 'muted' }, ' → ', used.get(fl.name)) : null),
      h('span', { class: 'muted' }, fmtSize(fl.size)),
      h('audio', { controls: true, preload: 'none', src: previewUrl(fl.name) }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Supprimer ' + fl.name, onClick: () => deleteFile(fl.name) }, '×'))))
    : h('p', { class: 'muted', style: 'margin:0;font-size:13px' }, 'Aucun son pour l’instant.');

  return section('Sons', 'Les fichiers restent privés jusqu’à la sortie. Mets des extraits si tu ne veux pas diffuser les titres entiers. Associe-les ensuite aux titres dans « Sortie & tracklist ».', drop, list);
}

const previewUrl = (name) => '/api/admin/audio/' + encodeURIComponent(name);

async function uploadFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  const fd = new FormData();
  files.forEach((fl) => fd.append('files', fl));
  toast('Envoi de ' + files.length + ' fichier(s)…');
  try {
    const data = await api('/admin/audio', { method: 'POST', body: fd, raw: true });
    state.files = data.files;
    const skipped = files.length - data.uploaded.length;
    toast(data.uploaded.length + ' fichier(s) envoyé(s)' + (skipped ? ` · ${skipped} refusé(s) (format)` : ''), skipped > 0);
    render();
  } catch (e) { toast(e.message, true); }
}

async function deleteFile(name) {
  const used = state.content.tracks.some((t) => t.audio === name);
  if (!window.confirm(`Supprimer « ${name} » ?` + (used ? '\nLe titre associé deviendra muet.' : ''))) return;
  try {
    const data = await api('/admin/audio/' + encodeURIComponent(name), { method: 'DELETE' });
    state.files = data.files;
    // Le serveur a aussi retiré ce son des titres enregistrés : on fait pareil ici.
    const strip = (c) => c.tracks.forEach((t) => { if (t.audio === name) t.audio = ''; });
    strip(state.content);
    const saved = JSON.parse(state.saved); strip(saved); state.saved = JSON.stringify(saved);
    toast('Fichier supprimé');
    render();
  } catch (e) { toast(e.message, true); }
}

/* ---------- Emails ---------- */

function viewEmails() {
  const tbody = h('tbody');
  const table = h('div', { class: 'table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, h('th', null, 'Email'), h('th', null, 'Inscrit le'), h('th', null, h('span', { class: 'umdc-sr' }, 'Actions')))),
    tbody));
  const fill = () => tbody.replaceChildren(...(state.subs.length
    ? state.subs.map((s) => h('tr', null,
      h('td', { class: 'email' }, s.email),
      h('td', { class: 'date' }, fmtDate(s.created_at)),
      h('td', { class: 'act' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Supprimer ' + s.email, onClick: () => deleteSub(s) }, '×'))))
    : [h('tr', null, h('td', { colspan: '3', class: 'date' }, state.q ? 'Aucune adresse ne correspond.' : 'Aucune inscription pour l’instant.'))]));
  fill();
  state.fillSubs = fill;

  let t;
  return section('Emails', 'Les adresses inscrites via « Rejoindre », avec la date de leur consentement. L’export CSV s’ouvre dans Excel, Numbers, Google Sheets, Brevo ou Mailchimp.',
    h('div', { style: 'display:flex;gap:16px;align-items:baseline;flex-wrap:wrap' },
      h('span', { class: 'stat', id: 'subs-total' }, String(state.subsTotal)),
      h('span', { class: 'micro muted' }, 'inscrit' + (state.subsTotal > 1 ? 's' : ''))),
    h('div', { class: 'mail-tools' },
      field('Rechercher', state.q, (v) => { state.q = v; clearTimeout(t); t = setTimeout(loadSubs, 250); }, { type: 'search', placeholder: 'nom@…' }),
      h('a', { class: 'umdc-btn umdc-btn-primary umdc-btn-m', href: '/api/admin/subscribers.csv', download: true },
        h('span', { class: 'umdc-btn-label' }, 'Exporter en CSV'), h('span', { class: 'umdc-btn-icon', 'aria-hidden': 'true' }, '↓')),
      btn('Copier les adresses', { onClick: copySubs })),
    table);
}

async function loadSubs() {
  try {
    const data = await api('/admin/subscribers?q=' + encodeURIComponent(state.q));
    state.subs = data.subscribers;
    state.subsTotal = data.total;
    if (state.tab === 'emails') {
      state.fillSubs?.();
      const total = $('#subs-total');
      if (total) total.textContent = String(data.total);
    }
  } catch (e) { toast(e.message, true); }
}

async function deleteSub(s) {
  if (!window.confirm(`Supprimer ${s.email} de la liste ?`)) return;
  try {
    await api('/admin/subscribers/' + s.id, { method: 'DELETE' });
    toast('Adresse supprimée');
    loadSubs();
  } catch (e) { toast(e.message, true); }
}

async function copySubs() {
  try {
    const text = state.subs.map((s) => s.email).join(', ');
    await navigator.clipboard.writeText(text);
    toast(state.subs.length + ' adresse(s) copiée(s)');
  } catch { toast('Copie impossible dans ce navigateur.', true); }
}

/* ---------------------------------------------------------------- actions */

async function save() {
  if (!dirty() || state.saving) return;
  state.saving = true;
  renderSavebar();
  try {
    const data = await api('/admin/content', { method: 'PUT', body: { content: state.content } });
    state.content = data.content;
    state.saved = JSON.stringify(data.content);
    state.updatedAt = data.updatedAt;
    state.released = data.released;
    toast('Enregistré');
    state.saving = false;
    render();
  } catch (e) {
    state.saving = false;
    renderSavebar();
    toast(e.message, true);
  }
}

async function logout() {
  if (dirty() && !window.confirm('Des modifications ne sont pas enregistrées. Se déconnecter quand même ?')) return;
  await api('/admin/logout', { method: 'POST' }).catch(() => {});
  state.authed = false;
  state.content = null;
  render();
}

async function loadFiles() {
  try {
    state.files = (await api('/admin/audio')).files;
    if (state.tab === 'sons' || state.tab === 'sortie') render();
  } catch (e) { toast(e.message, true); }
}

async function loadAll() {
  const data = await api('/admin/content');
  state.content = data.content;
  state.saved = JSON.stringify(data.content);
  state.updatedAt = data.updatedAt;
  state.released = data.released;
  state.subsTotal = data.subscribers;
  state.files = (await api('/admin/audio')).files;
  render();
  if (state.tab === 'emails') loadSubs();
}

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's' && state.authed) { e.preventDefault(); save(); }
});

(async () => {
  try {
    const me = await fetch('/api/admin/me', { credentials: 'same-origin' }).then((r) => r.json());
    state.authed = me.admin;
    if (state.authed) { await loadAll(); return; }
  } catch { /* API absente */ }
  render();
})();
