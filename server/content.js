// Contenu éditable du site : valeurs par défaut (reprises du design) et nettoyage
// de ce que le back-office envoie. Tout ce qui n'est pas prévu ici est ignoré.

export const DEFAULT_CONTENT = {
  home: {
    artist: 'Noé Mémorable',
    kicker: 'Noé Mémorable · UMDC',
    text: "L'album arrive prochainement. Rejoins la liste pour l'entendre avant tout le monde.",
    cta: 'Rejoindre la liste',
    hintCta: 'Dégager la cartouche',
    dragHint: 'Glisse pour tourner autour',
  },
  nav: {
    reseaux: 'Réseaux',
    rejoindre: 'Rejoindre',
    ecouter: 'Écouter',
  },
  reseaux: {
    kicker: 'Réseaux',
    title: 'Suis Noé Mémorable',
    text: "Extraits, coulisses et annonces passent d'abord par là.",
    footnote: "D'autres réseaux arrivent.",
  },
  socials: [
    { id: 'instagram', name: 'Instagram', handle: '[@COMPTE]', url: 'https://www.instagram.com/' },
    { id: 'x', name: 'X.com', handle: '[@COMPTE]', url: 'https://x.com/' },
  ],
  newsletter: {
    title: 'Rejoins la liste',
    text: "La sortie d'UMDC, les premiers extraits et les nouvelles de Noé Mémorable, directement dans ta boîte mail.",
    emailLabel: 'Ton e-mail',
    placeholder: 'nom@exemple.ch',
    button: "S'inscrire",
    consent: "J'accepte de recevoir la newsletter UMDC. Désinscription en un clic, à tout moment.",
    successTitle: 'Bienvenue',
    successText: "C'est noté. Tu seras parmi les premiers prévenus.",
  },
  privacy: {
    title: 'Confidentialité',
    text: "Ton adresse e-mail sert uniquement à t'envoyer les nouvelles d'UMDC et de Noé Mémorable. Elle n'est ni vendue ni partagée. Pour la faire supprimer, écris-nous.",
  },
  ecouter: {
    title: 'Écouter',
    text: "Les sons d’UMDC arrivent ici prochainement. Rejoins la liste pour être prévenu en premier.",
    notifyCta: 'Être prévenu',
    releasedTitle: 'La tracklist',
    releasedText: 'Choisis un titre pour en écouter un extrait.',
    platformsTitle: 'Aussi sur',
    previewLabel: 'Extrait · 30 s',
    previewEnd: 'Écoute la suite sur',
    previewNext: 'Extrait suivant',
  },
  release: {
    mode: 'auto', // auto | on | off
    date: '',
    albumTitle: 'Un monde de chalance',
    coverLabel: 'Prochainement',
  },
  platforms: [
    { id: 'spotify', name: 'Spotify', url: '' },
    { id: 'apple', name: 'Apple Music', url: '' },
    { id: 'deezer', name: 'Deezer', url: '' },
    { id: 'youtube', name: 'YouTube', url: '' },
  ],
  tracks: [
    'RASCALS', 'LARGO THEME', 'ÉCHOS DES PLAINES', 'LA DERNIÈRE FOIS', 'CD', ['OBSESSIONNEL', 'MSK'],
    'MAX THEME', 'UNE DEUX', 'RICANE', 'GOD MODE', 'IKEMEN', 'FACECARD', 'LA MARÉE',
    ['ARMAGEDDON', 'DE CAMELIS'], ['CANOPÉE', '3010'], 'CHALANCE THEME', 'MÉMO', 'CHALANCE FREESTYLE',
    'CIRQUE DU SOLEIL', '5 RUPTURES', 'CRISTAL CLEAR THEME', 'AVARICE', 'SPÉCIMEN ANGE', 'VESTIGES',
  ].map((t, i) => {
    const [title, feat] = Array.isArray(t) ? t : [t, ''];
    return { id: 't' + String(i + 1).padStart(2, '0'), title, feat, duration: '', audio: '', enabled: true };
  }),
};

const ITEM_SHAPES = {
  socials: { id: '', name: '', handle: '', url: '' },
  platforms: { id: '', name: '', url: '' },
  tracks: { id: '', title: '', feat: '', duration: '', previewStart: '', audio: '', enabled: true },
};

const URL_KEYS = new Set(['url']);
const MAX_STRING = 2000;
const MAX_ITEMS = 100;

function cleanString(value, key) {
  if (typeof value !== 'string') return null;
  const v = value.trim().slice(0, MAX_STRING);
  if (URL_KEYS.has(key) && v && !/^(https?:\/\/|mailto:)/i.test(v)) return '';
  return v;
}

function cleanId(value, fallback) {
  const v = typeof value === 'string' ? value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 40) : '';
  return v || fallback;
}

function cleanObject(input, shape) {
  const out = {};
  for (const [key, def] of Object.entries(shape)) {
    const v = input && typeof input === 'object' ? input[key] : undefined;
    if (typeof def === 'boolean') out[key] = typeof v === 'boolean' ? v : def;
    else if (typeof def === 'string') {
      const s = cleanString(v, key);
      out[key] = s === null ? def : s;
    }
  }
  return out;
}

function cleanList(input, key, fallback) {
  if (!Array.isArray(input)) return fallback;
  const shape = ITEM_SHAPES[key];
  const seen = new Set();
  return input.slice(0, MAX_ITEMS).map((item, i) => {
    const o = cleanObject(item, shape);
    let id = cleanId(o.id || o.name || o.title, key[0] + (i + 1));
    while (seen.has(id)) id += '-' + (i + 1);
    seen.add(id);
    o.id = id;
    if (key === 'tracks') {
      o.audio = /^[a-z0-9][a-z0-9._-]*$/i.test(o.audio) ? o.audio : '';
      o.duration = /^\d{1,2}:\d{2}$/.test(o.duration) ? o.duration : '';
      o.previewStart = /^\d{1,2}:\d{2}$/.test(o.previewStart) ? o.previewStart : '';
    }
    return o;
  });
}

// Fusionne une entrée (éventuellement partielle) avec les valeurs par défaut.
export function sanitizeContent(input, base = DEFAULT_CONTENT) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const [section, def] of Object.entries(DEFAULT_CONTENT)) {
    const fallback = base[section] ?? def;
    if (Array.isArray(def)) out[section] = cleanList(src[section], section, fallback);
    else out[section] = cleanObject(src[section] ?? fallback, { ...def, ...fallback });
  }
  if (!['auto', 'on', 'off'].includes(out.release.mode)) out.release.mode = 'auto';
  if (out.release.date && !Number.isFinite(Date.parse(out.release.date))) out.release.date = '';
  return out;
}

export function isReleased(content, now = Date.now()) {
  const { mode, date } = content.release;
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  const t = Date.parse(date || '');
  return Number.isFinite(t) && now >= t;
}

// Ce que voit le public : avant la sortie, ni titres, ni sons, ni plateformes.
export function publicContent(content, now = Date.now()) {
  const released = isReleased(content, now);
  const { tracks, platforms, release, ...rest } = content;
  const t = Date.parse(release.date || '');
  return {
    ...rest,
    release: {
      released,
      // L'heure de sortie n'est donnée que si elle est automatique, pour rafraîchir la page au bon moment.
      opensAt: !released && release.mode === 'auto' && Number.isFinite(t) ? new Date(t).toISOString() : null,
      albumTitle: release.albumTitle,
      coverLabel: release.coverLabel,
    },
    socials: content.socials.filter((s) => s.url && s.name),
    platforms: released ? platforms.filter((p) => p.url && p.name) : [],
    trackCount: tracks.filter((tr) => tr.enabled).length,
    tracks: released
      ? tracks.filter((tr) => tr.enabled).map((tr) => ({
          id: tr.id,
          title: tr.title,
          feat: tr.feat,
          duration: tr.duration,
          src: tr.audio ? '/api/audio/' + encodeURIComponent(tr.id) : '',
        }))
      : [],
  };
}
