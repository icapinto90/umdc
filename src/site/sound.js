// Le son du site : un extrait d'« Échos des plaines » en boucle, allumé par défaut à volume modéré,
// une note à chaque choix de menu (toujours, même son coupé) et le souffle du sable au déblayage (WebAudio).
// La musique part au premier geste du visiteur (les navigateurs bloquent le son avant). Elle commence à 5 s du début
// du morceau, en fondu ; avant la fin elle s'efface en fondu, puis reprend à 5 s, de nouveau en fondu, et ainsi de suite.

const MUSIC = '/audio/ambient.m4a';
// Volume de la musique (0 à 1). Le fichier est mixé fort : 0.2 reste en fond.
const LEVEL = 0.2;
// Point de départ dans le morceau (secondes), et durées des fondus d'entrée et de sortie.
const START_AT = 5;
const FADE_IN = 3;
const FADE_OUT = 3;
// Volume de la note des menus : elle joue toujours, même son coupé.
const BLIP = 0.22;

export class Ambient {
  constructor() {
    this.on = false;
    this.ac = null;
    this.master = null;
    this.music = null;
    this.level = LEVEL;
    this.gain = 0; // volume du fondu en cours (0 à 1), multiplié par le niveau
    this.fade = null;
    this.looping = false;
  }

  toggle() {
    this.on = !this.on;
    if (this.on) this.start(); else this.stop();
    return this.on;
  }

  /* Lance la musique au premier clic, toucher ou touche du clavier, sauf sur les éléments que `ignore` désigne. */
  startOnFirstGesture(ignore) {
    const evs = ['pointerdown', 'keydown', 'touchstart'];
    const go = (e) => {
      if (ignore && ignore(e)) return;
      evs.forEach((n) => window.removeEventListener(n, go, true));
      if (this.on && (!this.music || this.music.paused)) this.start();
    };
    evs.forEach((n) => window.addEventListener(n, go, true));
  }

  /* Le contexte audio, créé au premier besoin (toujours pendant un geste du visiteur). */
  context() {
    if (!this.ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ac = new AC();
    }
    if (this.ac.state === 'suspended') this.ac.resume().catch(() => {});
    return this.ac;
  }

  start() {
    try {
      if (!this.music) {
        const el = this.music = new Audio(MUSIC);
        el.preload = 'auto';
        el.addEventListener('timeupdate', () => this.watchEnd());
        el.addEventListener('ended', () => this.restart());
        const ac = this.context();
        if (ac) {
          const master = this.master = ac.createGain();
          master.gain.value = 0;
          master.connect(ac.destination);
          try { ac.createMediaElementSource(el).connect(master); } catch (e) { this.master = null; }
        }
      }
      this.context();
      this.restart();
    } catch (e) { /* pas d'audio : tant pis */ }
  }

  /* Repart à 5 s, en fondu d'entrée. */
  restart() {
    const el = this.music;
    if (!el || !this.on) return;
    this.looping = false;
    this.fadeTo(0, 0);
    try { el.currentTime = START_AT; } catch (e) { /* métadonnées pas encore là : on part de 0 */ }
    el.play().then(() => this.fadeTo(1, FADE_IN)).catch(() => {});
  }

  /* Quelques secondes avant la fin : fondu de sortie, puis on reprend au début de la boucle. */
  watchEnd() {
    const el = this.music;
    if (!el || this.looping || !isFinite(el.duration)) return;
    if (el.duration - el.currentTime <= FADE_OUT) {
      this.looping = true;
      this.fadeTo(0, Math.max(0.1, el.duration - el.currentTime - 0.05), () => this.restart());
    }
  }

  stop() {
    this.looping = false;
    this.fadeTo(0, 0);
    if (this.music) this.music.pause();
  }

  // Pendant la lecture d'un titre de l'album, l'extrait se retire presque entièrement.
  duck(playing) {
    this.level = playing ? 0.02 : LEVEL;
    this.apply();
  }

  /* Fondu du volume vers `to` (0 à 1) en `seconds`, puis `done`. */
  fadeTo(to, seconds, done) {
    clearInterval(this.fade);
    const from = this.gain, t0 = performance.now(), ms = seconds * 1000;
    if (ms <= 0) { this.gain = to; this.apply(); if (done) done(); return; }
    this.fade = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      this.gain = from + (to - from) * k;
      this.apply();
      if (k >= 1) { clearInterval(this.fade); if (done) done(); }
    }, 40);
  }

  apply() {
    const v = this.gain * this.level;
    try {
      if (this.ac && this.master) this.master.gain.value = v;
      else if (this.music) this.music.volume = v;
    } catch (e) { /* rien */ }
  }

  /* Une note douce (sinus) à chaque choix : toujours jouée, même son coupé, hors du volume de la musique. */
  blip(freq) {
    try {
      const ac = this.context();
      if (!ac) return;
      const t = ac.currentTime;
      const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = freq || 523;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(BLIP, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 1);
    } catch (e) { /* rien */ }
  }

  /* Le souffle du sable qui se soulève, si le son est allumé (indépendant des fondus de la musique). */
  whoosh() {
    try {
      if (!this.on || !this.ac) return;
      const ac = this.ac, t = ac.currentTime, len = Math.floor(ac.sampleRate * 2.4);
      const buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / len);
      const src = ac.createBufferSource(); src.buffer = buf;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.6;
      bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(1100, t + 1.1); bp.frequency.exponentialRampToValueAtTime(420, t + 2.4);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.035, t + 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      src.connect(bp); bp.connect(g); g.connect(this.ac.destination); src.start(t);
    } catch (e) { /* rien */ }
  }
}
