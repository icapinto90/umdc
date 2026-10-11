// Le son du site : un extrait d'« Échos des plaines » en boucle, allumé par défaut à volume modéré,
// une note à chaque choix et le souffle du sable au déblayage (WebAudio).
// La musique ne démarre que sur un clic (« Entrer » ou le bouton Son) : les navigateurs bloquent le son avant un geste.

const MUSIC = '/audio/ambient.m4a';
// Volume de la musique (0 à 1). Le fichier est mixé fort : 0.2 reste en fond.
const LEVEL = 0.2;

export class Ambient {
  constructor() {
    this.on = false;
    this.ac = null;
    this.master = null;
    this.music = null;
    this.level = LEVEL;
  }

  toggle() {
    this.on = !this.on;
    if (this.on) this.start(); else this.stop();
    return this.on;
  }

  start() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!this.music) {
        const el = this.music = new Audio(MUSIC);
        el.loop = true; el.preload = 'auto';
        if (AC) {
          const ac = this.ac = new AC();
          const master = this.master = ac.createGain();
          master.connect(ac.destination);
          try { ac.createMediaElementSource(el).connect(master); } catch (e) { this.master = null; }
        }
      }
      this.setLevel(this.level);
      if (this.ac && this.ac.state === 'suspended') this.ac.resume().catch(() => {});
      this.music.play().catch(() => {});
    } catch (e) { /* pas d'audio : tant pis */ }
  }

  stop() {
    if (this.music) this.music.pause();
  }

  // Pendant la lecture d'un titre de l'album, l'extrait se retire presque entièrement.
  duck(playing) {
    this.level = playing ? 0.02 : LEVEL;
    if (this.on) this.setLevel(this.level);
  }

  /* Le volume, appliqué tout de suite (pas de fondu). */
  setLevel(value) {
    try {
      if (this.ac && this.master) {
        const g = this.master.gain;
        g.cancelScheduledValues(this.ac.currentTime);
        g.value = value;
      } else if (this.music) this.music.volume = value;
    } catch (e) { /* rien */ }
  }

  /* Une note douce (sinus) à chaque choix, seulement si le son est allumé. */
  blip(freq) {
    try {
      if (!this.on || !this.ac || !this.master) return;
      const ac = this.ac, t = ac.currentTime;
      const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = freq || 523;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 1);
    } catch (e) { /* rien */ }
  }

  /* Le souffle du sable qui se soulève. */
  whoosh() {
    try {
      if (!this.on || !this.ac || !this.master) return;
      const ac = this.ac, t = ac.currentTime, len = Math.floor(ac.sampleRate * 2.4);
      const buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / len);
      const src = ac.createBufferSource(); src.buffer = buf;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.6;
      bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(1100, t + 1.1); bp.frequency.exponentialRampToValueAtTime(420, t + 2.4);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      src.connect(bp); bp.connect(g); g.connect(this.master); src.start(t);
    } catch (e) { /* rien */ }
  }
}
