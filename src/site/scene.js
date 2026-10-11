// La scène 3D : un îlot de sable sur l'eau, le collier scanné, la cartouche de verre et son DVD,
// sous un ciel bleu à cumulus. Portage du design (Claude Design, « Site UMDC — écran 3D »).
//
// `app` fournit l'état lu à chaque image et reçoit les événements :
//   app.intro, app.phase, app.mouse {x,y}, app.camSec(), app.isPlaying(),
//   app.onProgress(p), app.onModelReady(failed), app.onCoverClick()

import * as THREE from 'three';

const ASSETS = {
  model: '/models/collier.bin',
  base: '/textures/collier-base.jpg',
  normal: '/textures/collier-normal.jpg',
  ao: '/textures/collier-ao.jpg',
  logo: '/assets/logo-umdc.png',
};

/* Le ciel photo : « Kloofendal 48d Partly Cloudy (Pure Sky) », Poly Haven (CC0), moitié haute, étalonnée plus bleue et plus contrastée :
   bleu profond, cumulus blancs. Le soleil de la photo est très haut (48°), toujours hors cadre : on dessine le nôtre posé sur l'horizon,
   à gauche de la cartouche, avec sa colonne de lumière. uSun / el = sa place (0-1 en largeur de l'image, hauteur en degrés) ;
   disque, halo, étoile de rayons, reflets et lumière partent de là. lightEl = la hauteur minimale de notre lumière.
   view = la partie de l'image qu'on voit derrière la cartouche. */
const SKY = { url: '/textures/sky-blue.jpg', url8k: '/textures/sky-blue-8k.jpg', uSun: 0.73, el: 3, lightEl: 7, view: 0.68 };
/* Lumière du ciel photo ; celle des nuages peints (secours) reste celle du design. */
const LIGHT = {
  photo: { sun: 0xfff8ee, sky: 0xe6eefb, ground: 0xf0ebe2, sunCol: [1.0, 0.97, 0.92] },
  peint: { sun: 0xfff6ea, sky: 0xeef4fb, ground: 0xf2ece2, sunCol: [1.0, 0.97, 0.9] },
};

export class Stage {
  constructor(canvas, app) {
    this.app = app;
    this.canvas = canvas;
    this._s = null;
    this.frame = this.frame.bind(this);
    this.initScene(canvas);
  }

  /* ---------- événements venus de l'interface ---------- */

  /* La brume se lève et la caméra descend vers l'îlot en 3 s. */
  panorama() { if (this._s) this._s.panoAt = this._s.t; this.camTween(3); }
  /* Le déblayage : 2,4 s d'un seul mouvement. La cartouche sort du sable et vient en gros plan. */
  unearth() {
    const s = this._s;
    if (s) { s.unearthAt = s.t; s.burstPending = true; }
    this.camTween(this.unearthDur());
  }
  skip() {}
  navigate() {}
  unearthDur() { return 2.4; }

  /* ---------- cadrages ---------- */

  /* La cartouche une fois en main : elle reste là, devant toi, l'horizon derrière elle et le collier dans le sable à sa droite. */
  heldBase() { return { x: -1.15, y: 0.95, z: 0.55, th: 0, ph: -0.01 }; }
  fov() { return 40; }

  /* Cadrage du site, section par section. On ne dézoome jamais : la caméra reste en gros plan sur la cartouche,
     elle la décale seulement pour laisser la place au panneau. fx/fy = où la cartouche tombe à l'écran (0-1),
     cry/crx = la cartouche se tourne un peu vers le panneau ouvert. */
  poseFor(sec, W, H) {
    const mobile = W < 761, aspect = W / Math.max(1, H), B = this.heldBase();
    const tanH = 2 * Math.tan(this.fov() / 2 * Math.PI / 180);
    /* distance pour que la cartouche (1,3 de côté) occupe hf de la hauteur et au plus wf de la largeur */
    const fit = (hf, wf) => Math.max(1.3 / (tanH * hf), 1.3 / (tanH * aspect * wf));
    const p = { th: B.th, ph: B.ph, tx: B.x, ty: B.y, tz: B.z, cry: 0, crx: 0 };
    if (sec === 'accueil') {
      p.fx = 0.5; p.fy = mobile ? 0.38 : 0.44; p.r = mobile ? fit(0.4, 0.78) : fit(0.54, 0.6);
    } else if (mobile) {
      p.fx = 0.5; p.fy = 0.2; p.r = fit(0.27, 0.62); p.crx = 0.05;
    } else {
      const panelW = W >= 1100 ? 480 : 440, left = W - panelW - 64;
      p.fx = (32 + left * 0.5) / W; p.fy = 0.46; p.r = Math.max(fit(0.58, 1), 1.3 / (tanH * aspect * (left * 0.78 / W)));
      p.cry = sec === 'ecouter' ? 0.14 : 0.1;
    }
    return p;
  }
  /* L'angle de caméra qui regarde droit vers le soleil (et sa colonne de lumière). */
  sunTh() { return (SKY.uSun - SKY.view - 0.5) * Math.PI * 2 + Math.PI; }
  /* Début : très haut, dans la brume, déjà tourné vers le soleil. */
  introPose() { return { th: this.sunTh(), ph: 1.2, r: 13, tx: -0.7, ty: 0, tz: 0.1, fx: 0.5, fy: 0.5, cry: 0, crx: 0 }; }
  /* En attendant le clic : un long vol lent autour du collier et de la cartouche, au ras de l'eau.
     Il part face au soleil et à sa colonne de lumière, puis tourne doucement (t = secondes depuis le début du panorama). */
  panoramaPose(t, W, H) {
    const k = Math.max(1, (1.6 / (W / Math.max(1, H))) * 0.5);
    return {
      th: this.sunTh() + t * 0.03, ph: 0.12 + Math.sin(t * 0.037 + 1.0) * 0.045, r: (8.2 + Math.sin(t * 0.045) * 2.4) * k,
      tx: -0.7 + Math.sin(t * 0.021) * 0.5, ty: 0.7, tz: 0.15 + Math.cos(t * 0.017) * 0.5, fx: 0.5, fy: 0.64,
      cry: 0, crx: 0,
    };
  }
  coverBuried() { return { x: -1.45, y: 0.04, z: 0.2, rx: -1.22, ry: 0.45, rz: -0.12 }; }
  /* Point de passage : elle sort d'abord du sable presque à la verticale. */
  coverLifted() { return { x: -1.45, y: 0.78, z: 0.24, rx: -0.5, ry: 0.3, rz: -0.03 }; }
  /* En main : face à la caméra, un léger flottement et elle suit un peu la souris. */
  heldCover(s, c, rm) {
    const B = this.heldBase(), t = s.t;
    return {
      x: B.x, y: B.y + (rm ? 0 : Math.sin(t * 0.55) * 0.02), z: B.z,
      rx: -B.ph + c.crx - s.m.y * 0.06 + (rm ? 0 : Math.sin(t * 0.43) * 0.015),
      ry: B.th + c.cry + s.m.x * 0.14 + (rm ? 0 : Math.sin(t * 0.31) * 0.025),
      rz: rm ? 0 : Math.sin(t * 0.37) * 0.01,
    };
  }
  /* Courbe douce : démarre lentement, accélère, puis se pose sans à-coup. */
  ease(p) { p = Math.max(0, Math.min(1, p)); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  angDiff(b, a) { return Math.atan2(Math.sin(b - a), Math.cos(b - a)); }
  /* La caméra part de là où elle est et rejoint la pose de la phase suivante en `dur` secondes. */
  camTween(dur) {
    const s = this._s;
    if (s) s.tw = { from: Object.assign({}, s.cam), t0: s.t, dur };
  }

  /* Ressort amorti : accélère puis ralentit de lui-même, sans arrêt sec. */
  spring(o, k, target, w, dt) {
    const v = o[k + 'V'] || 0;
    const a = w * w * (target - o[k]) - 2 * w * v;
    const nv = v + a * dt;
    o[k + 'V'] = nv;
    o[k] += nv * dt;
  }
  springAngle(o, k, target, w, dt) {
    const d = Math.atan2(Math.sin(target - o[k]), Math.cos(target - o[k]));
    this.spring(o, k, o[k] + d, w, dt);
  }

  /* ---------- relief de l'îlot (calculé une fois, côté JS) ---------- */
  hash2(x, y) { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); }
  vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = this.hash2(xi, yi), b = this.hash2(xi + 1, yi), c = this.hash2(xi, yi + 1), d = this.hash2(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  fbm2(x, y) { let v = 0, a = 0.5; for (let i = 0; i < 5; i++) { v += a * this.vnoise(x, y); x *= 2.03; y *= 2.03; a *= 0.5; } return v; }
  smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  /* L'îlot : un banc de sable presque plat, posé sur l'eau. isle = son centre et ses rayons, waterY = le niveau de l'eau. */
  isle() { return { x: -0.75, z: 0.15, rx: 2.4, rz: 1.95 }; }
  waterY() { return -0.1; }
  isleEdge(a) { return 1 + (this.fbm2(Math.cos(a) * 1.3 + 4.1, Math.sin(a) * 1.3 + 2.7) - 0.5) * 0.22; }
  islandH(x, z) {
    const I = this.isle(), dx = (x - I.x) / I.rx, dz = (z - I.z) / I.rz;
    const q = Math.hypot(dx, dz) / this.isleEdge(Math.atan2(dz, dx));
    if (q < 0.6) return 0;
    return Math.max(-0.95, -0.24 * Math.pow((q - 0.6) / 0.62, 2));
  }
  /* Hauteur du sol (ou de l'eau) sous un point : la caméra ne descend jamais dedans. */
  hAt(s, x, z) { return Math.max(this.islandH(x, z), this.waterY()); }

  /* Le ciel affiché : la photo ; si elle ne charge pas, les nuages peints du design. */
  skyMode() { return this._s && this._s.skyFailed ? 'peint' : 'photo'; }
  ensureSky(s, cb) {
    let e = s.skyPhoto;
    if (!e) {
      e = s.skyPhoto = { ready: false, cbs: [] };
      /* 8192 px de large (deux fois plus net) quand la carte graphique et l'écran le permettent, sinon 4096. */
      const big = (s.renderer.capabilities.maxTextureSize || 4096) >= 8192 && (window.screen ? window.screen.width : 1440) > 700;
      e.tex = new THREE.TextureLoader().load(big ? SKY.url8k : SKY.url,
        () => { e.ready = true; e.cbs.forEach((f) => f()); e.cbs = []; },
        undefined,
        () => { s.skyFailed = true; e.cbs.forEach((f) => f()); e.cbs = []; });
      e.tex.wrapS = THREE.RepeatWrapping; e.tex.wrapT = THREE.ClampToEdgeWrapping;
      e.tex.generateMipmaps = false; e.tex.minFilter = THREE.LinearFilter; e.tex.magFilter = THREE.LinearFilter;
    }
    if (cb) { if (e.ready || s.skyFailed) cb(); else e.cbs.push(cb); }
    return e;
  }

  /* Les nuages, peints comme une toile (secours si la photo ne charge pas) : de grands cumulus posés au-dessus de l'eau
     tout autour, petits et pâles au loin, plus grands et plus nets en hauteur. Une trouée est laissée autour du soleil.
     La bande va de l'horizon (en bas) à emax radians (en haut) ; 360° en largeur. */
  paintClouds(TW, TH, emax, sunAz) {
    const cv = document.createElement('canvas'); cv.width = TW; cv.height = TH;
    const g = cv.getContext('2d');
    let seed = 7031;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const away = (a) => Math.abs(Math.atan2(Math.sin(a - sunAz), Math.cos(a - sunAz)));
    const clouds = [];
    const groups = [];
    for (let k = 0; k < 22; k++) groups.push(rnd() * Math.PI * 2);
    for (let k = 0; k < 170; k++) {
      const a = rnd() * Math.PI * 2;
      if (away(a) < 0.1 && rnd() < 0.9) continue;
      clouds.push({ a, D: 3000 + rnd() * 1400, alt: 35 + rnd() * 55, W: 110 + Math.pow(rnd(), 1.4) * 320 });
    }
    for (let k = 0; k < 190; k++) {
      const far = k < 120;
      const a = (rnd() < 0.65 ? groups[Math.floor(rnd() * groups.length)] + (rnd() - 0.5) * 0.5 : rnd() * Math.PI * 2);
      if (away(a) < (far ? 0.12 : 0.3) && rnd() < 0.9) continue;
      const D = far ? 1500 + rnd() * 2600 : 420 + Math.pow(rnd(), 0.7) * 1400;
      clouds.push({ a, D, alt: far ? 55 + rnd() * 70 : 80 + rnd() * 90, W: (far ? 70 : 100) + Math.pow(rnd(), 1.6) * 260 });
    }
    clouds.sort((p, q) => q.D - p.D);
    const elRow = (el) => TH * (1 - el / emax);
    clouds.forEach((c) => {
      const kx = TW / (Math.PI * 2 * c.D);
      const H = c.W * (0.38 + 0.34 * rnd());
      const elB = Math.atan(c.alt / c.D), elT = Math.atan((c.alt + H * 1.15) / c.D);
      if (elT > emax * 0.86) return;
      const ky = (elRow(elB) - elRow(elT)) / (H * 1.15);
      const towers = [];
      for (let t = 0, n = 2 + Math.floor(rnd() * 3); t < n; t++) towers.push({ x: (rnd() * 2 - 1) * c.W * 0.3, h: H * (0.55 + 0.45 * rnd()), w: c.W * (0.13 + 0.12 * rnd()) });
      const topAt = (x) => {
        let h = H * 0.4 * Math.pow(Math.max(0, 1 - Math.pow(x / (c.W * 0.5), 2)), 0.7);
        towers.forEach((t) => { const q = (x - t.x) / t.w; h = Math.max(h, t.h * Math.max(0, 1 - q * q)); });
        return h;
      };
      const puffs = [];
      const nb = Math.round(22 + c.W / 7);
      for (let i = 0; i < nb; i++) {
        const x = (rnd() * 2 - 1) * c.W * 0.47, top = topAt(x);
        if (top < H * 0.1) continue;
        const y = top * (0.12 + 0.72 * Math.pow(rnd(), 0.7));
        puffs.push({ x, y, r: Math.max(c.W * 0.05, Math.min(top - y + c.W * 0.05, c.W * 0.16)) * (0.8 + 0.4 * rnd()) });
      }
      for (let x = -c.W * 0.48; x < c.W * 0.48;) {
        const top = topAt(x), r = c.W * (0.022 + 0.04 * rnd()) * (0.6 + 0.6 * Math.min(1, top / H));
        if (top > H * 0.1) puffs.push({ x, y: top - r * (0.55 + 0.3 * rnd()), r });
        x += r * (0.9 + 0.5 * rnd());
      }
      for (let i = 0; i < 6; i++) puffs.push({ x: (rnd() * 2 - 1) * c.W * 0.38, y: c.W * 0.03, r: c.W * (0.1 + 0.06 * rnd()) });
      puffs.sort((p, q) => p.y - q.y);
      const pad = c.W * 0.12, lw = Math.ceil((c.W + pad * 2) * kx), lh = Math.ceil((H * 1.15 + pad) * kx);
      if (lw < 6 || lh < 4) return;
      const lc = document.createElement('canvas'); lc.width = lw; lc.height = lh;
      const l = lc.getContext('2d');
      const X = (x) => (x + c.W * 0.5 + pad) * kx, Y = (y) => lh - y * kx;
      const fade = Math.min(1, Math.max(0, (c.D - 900) / 3000));
      const sh = [Math.round(150 + 50 * fade), Math.round(170 + 40 * fade), Math.round(214 + 20 * fade)];
      puffs.forEach((p) => {
        const gr = l.createRadialGradient(X(p.x), Y(p.y), 0, X(p.x), Y(p.y), p.r * kx);
        const k = 0.86 + 0.14 * Math.min(1, p.y / H);
        const col = 'rgba(' + Math.round(sh[0] * k + 255 * (1 - k)) + ',' + Math.round(sh[1] * k + 255 * (1 - k)) + ',' + Math.round(sh[2] * k + 255 * (1 - k)) + ',';
        gr.addColorStop(0, col + '1)'); gr.addColorStop(0.8, col + '1)'); gr.addColorStop(1, col + '0)');
        l.fillStyle = gr; l.beginPath(); l.arc(X(p.x), Y(p.y), p.r * kx, 0, Math.PI * 2); l.fill();
      });
      l.globalCompositeOperation = 'source-atop';
      const topY = Y(H * 1.05), midY = Y(H * 0.3);
      const gl = l.createLinearGradient(0, topY, 0, midY);
      gl.addColorStop(0, 'rgba(255,255,253,0.92)'); gl.addColorStop(0.55, 'rgba(250,252,255,0.55)'); gl.addColorStop(1, 'rgba(245,249,255,0)');
      l.fillStyle = gl; l.fillRect(0, 0, lw, lh);
      puffs.forEach((p) => {
        const lift = Math.min(1, p.y / H + 0.2);
        const hx = X(p.x - p.r * 0.25), hy = Y(p.y + p.r * 0.42);
        const gr = l.createRadialGradient(hx, hy, 0, hx, hy, p.r * kx * 0.85);
        gr.addColorStop(0, 'rgba(255,255,253,' + (0.55 * lift) + ')');
        gr.addColorStop(0.6, 'rgba(250,252,255,' + (0.22 * lift) + ')');
        gr.addColorStop(1, 'rgba(240,246,255,0)');
        l.fillStyle = gr; l.beginPath(); l.arc(hx, hy, p.r * kx * 0.85, 0, Math.PI * 2); l.fill();
      });
      const gb = l.createLinearGradient(0, lh, 0, lh - H * 0.4 * kx);
      gb.addColorStop(0, 'rgba(120,145,195,0.4)'); gb.addColorStop(1, 'rgba(120,145,195,0)');
      l.fillStyle = gb; l.fillRect(0, 0, lw, lh);
      if (fade > 0) { l.fillStyle = 'rgba(214,232,250,' + (fade * 0.45) + ')'; l.fillRect(0, 0, lw, lh); }
      l.globalCompositeOperation = 'destination-out';
      const cut = l.createLinearGradient(0, lh, 0, lh - Math.max(2, c.W * 0.015 * kx));
      cut.addColorStop(0, 'rgba(0,0,0,1)'); cut.addColorStop(1, 'rgba(0,0,0,0)');
      l.fillStyle = cut; l.fillRect(0, lh - Math.max(2, c.W * 0.015 * kx), lw, lh);
      l.globalCompositeOperation = 'source-over';
      const u = ((c.a / (Math.PI * 2)) + 0.5) % 1;
      const cx = u * TW, by = elRow(elB), dh = lh * ky / kx;
      [-TW, 0, TW].forEach((o) => {
        const x0 = cx + o - lw / 2;
        if (x0 > TW || x0 + lw < 0) return;
        g.drawImage(lc, x0, by - dh, lw, dh);
      });
    });
    return cv;
  }

  /* Les uniformes du ciel, partagés par tout ce qui le dessine ou le reflète. */
  skyUniforms(s, hdr) {
    return {
      uSun: s.uSun, uSunCol: s.uSunCol, uTime: s.uTime, uSkyTime: s.uSkyTime, uMist: s.uMist, uMistCol: s.uMistCol,
      uClouds: s.uClouds, uCloudRot: s.uCloudRot, uSkyTex: s.uSkyTex, uSkyRot: s.uSkyRot, uSkyMode: s.uSkyMode,
      uHdr: { value: hdr }, uPillar: { value: 1 },
    };
  }

  /* Ombres de nuages qui glissent sur le sable et le collier ; le bord du scan s'enfonce et se fond dans le sable. */
  patchGround(sh, s, isScan) {
    Object.assign(sh.uniforms, this.skyUniforms(s, 0));
    sh.uniforms.uCloud = s.uCloud; sh.uniforms.uFloor = { value: s.ALB }; sh.uniforms.uAer = s.uAer;
    // le lointain du sable prend la couleur du ciel, pas la colonne de lumière (sinon un trait blanc barre l'îlot)
    sh.uniforms.uPillar.value = 0;
    let v = 'varying vec3 vWorldP;\nvarying vec3 vLocalP;\n' + sh.vertexShader;
    if (isScan) {
      v = v.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  float eV = smoothstep(0.8, 1.12, length((position.xz - vec2(0.0, 0.1)) / vec2(0.46, 0.8)));\n  objectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), eV));');
      v = v.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed.y = mix(transformed.y, -0.02, eV);');
    }
    sh.vertexShader = v.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vLocalP = position;\n  vWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    let f = 'varying vec3 vWorldP;\nvarying vec3 vLocalP;\nuniform float uTime;\nuniform float uCloud;\nuniform vec3 uFloor;\nuniform float uMist;\nuniform vec3 uMistCol;\nuniform float uAer;\n'
      + s.noiseGLSL + '\n' + s.skyGLSL + '\n' + s.skyFullGLSL + '\n' + sh.fragmentShader;
    if (isScan) f = f.replace('#include <map_fragment>', [
      '#include <map_fragment>',
      '  {',
      '    float eR = length((vLocalP.xz - vec2(0.0, 0.1)) / vec2(0.46, 0.8));',
      /* au-delà de la zone fondue dans le sable, le reste du scan (ses coins) est coupé : près du bord de l'îlot, là où le sable
         descend, il ressortirait comme une plaque */
      '    if (eR > 1.08) discard;',
      '    vec3 dc = diffuseColor.rgb;',
      '    float lumD = dot(dc, vec3(0.2126, 0.7152, 0.0722));',
      '    float satD = max(max(dc.r, dc.g), dc.b) - min(min(dc.r, dc.g), dc.b);',
      '    float paper = smoothstep(0.1, 0.03, satD) * smoothstep(0.12, 0.3, lumD);',
      '    vec3 warm = min(uFloor * (lumD / dot(uFloor, vec3(0.2126, 0.7152, 0.0722))), vec3(1.0));',
      '    dc = mix(dc, mix(warm, uFloor, 0.5), paper * 0.9);',
      '    diffuseColor.rgb = mix(dc, uFloor, smoothstep(0.7, 1.0, eR));',
      '  }',
    ].join('\n'));
    f = f.replace('#include <color_fragment>', [
      '#include <color_fragment>',
      '  {',
      '    vec2 cp = vWorldP.xz * 0.55;',
      '    float cn = fbm(cp + vec2(uTime * 0.03, uTime * 0.018));',
      '    cn = fbm(cp * 0.9 + cn * 1.8 + vec2(-uTime * 0.02, uTime * 0.012));',
      '    diffuseColor.rgb *= 1.0 - uCloud * smoothstep(0.42, 0.72, cn);',
      '  }',
    ].join('\n'));
    /* Perspective aérienne : plus c'est loin, plus le sable prend la couleur de l'horizon dans cette direction (celle du ciel affiché). */
    f = f.replace('#include <fog_fragment>', [
      '#include <fog_fragment>',
      '  {',
      '    vec3 dv = vWorldP - cameraPosition;',
      '    float dist = length(dv);',
      '    float fa = max(1.0 - exp(-dist * uAer), uMist);',
      /* la couleur unie de l'horizon (lire le ciel au ras de l'horizon recopierait une seule rangée de pixels : des stries) */
      '    vec3 hz = uSkyMode > 0.5 ? vec3(0.77, 0.81, 0.88) : skyFull(normalize(vec3(dv.x, 0.012 * length(dv.xz), dv.z)));',
      '    vec3 hzo = linearToOutputTexel(vec4(toLin(mix(hz, uMistCol, uMist)), 1.0)).rgb;',
      '    gl_FragColor.rgb = mix(gl_FragColor.rgb, hzo, fa);',
      '  }',
    ].join('\n'));
    sh.fragmentShader = f;
  }

  initScene(canvas) {
    const app = this.app;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch (e) {
      app.onModelReady(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;

    /* Lumière : un soleil bas, presque en face, qui pose une colonne de lumière dorée sur l'eau. */
    const FOV = this.fov(), EL = 12 * Math.PI / 180, HEMI = 1.0, SUN = 1.4, WY = this.waterY();
    const ALB = new THREE.Color(0xc2bcb2).convertSRGBToLinear();
    const HZ = new THREE.Color(0.88, 0.86, 0.88);
    renderer.setClearColor(HZ, 1);
    const scene = new THREE.Scene();
    const intro = app.intro && app.phase !== 'ready';
    scene.fog = new THREE.FogExp2(HZ.getHex(), intro ? 0.5 : 0.05);
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 6000);
    const startCam = intro ? this.introPose() : this.poseFor(app.camSec(), canvas.clientWidth || 1440, canvas.clientHeight || 900);
    const hb = this.heldBase();
    const aniso = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
    const S = 1.3, HS = S / 2, C = 0.075;

    const s = this._s = {
      renderer, scene, camera, canvas, FOV, EL, ALB, aniso,
      t: 0, last: 0, W: 1, H: 1, cam: Object.assign({}, startCam), m: { x: 0, y: 0 },
      cv: Object.assign({}, intro ? this.coverBuried() : { x: hb.x, y: hb.y, z: hb.z, rx: -hb.ph + startCam.crx, ry: hb.th + startCam.cry, rz: 0 }),
      heap: { a: intro ? 1 : 0 }, halo: 0, tw: null, envAt: -99, cubeAt: -99, panoAt: null,
      drag: { on: false, x: 0, y: 0, off: 0, vel: 0, lt: 0, downT: 0, moved: 0 },
      fogD: intro ? 0.5 : 0.05, sunAz: Math.PI + 0.17, el: intro ? 9 * Math.PI / 180 : EL,
      unearthAt: null, burstPending: false,
      target: new THREE.Vector3(), tmp: new THREE.Vector3(), tmp2: new THREE.Vector3(), ray: new THREE.Raycaster(),
      uTime: { value: 0 }, uSkyTime: { value: 0 }, uCloud: { value: 0 }, uClouds: { value: null }, uCloudRot: { value: 0 },
      uSkyTex: { value: null }, uSkyRot: { value: 0 }, uSkyMode: { value: 0 }, activeSky: null,
      uSun: { value: new THREE.Vector3(0, 0.2, -1).normalize() }, uSunCol: { value: new THREE.Vector3(1, 0.97, 0.9) },
      uMist: { value: intro ? 1 : 0 }, uMistCol: { value: new THREE.Vector3(0.92, 0.89, 0.86) }, uAer: { value: 1 / 1100 }, mist: intro ? 1 : 0,
      reduced: !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches),
    };
    s.noiseGLSL = [
      'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
      'float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);',
      '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }',
      'float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }',
    ].join('\n');
    /* Le ciel procédural (couleurs « écran ») : sert aux nuages peints de secours. */
    s.skyGLSL = [
      'uniform vec3 uSun;',
      'uniform vec3 uSunCol;',
      'vec3 toLin(vec3 c){ c = max(c, 0.0); return mix(c * 0.0773993808, pow(c * 0.9478672986 + 0.0521327014, vec3(2.4)), vec3(greaterThan(c, vec3(0.04045)))); }',
      'vec3 skyCol(vec3 d){',
      '  float y = max(d.y, 0.0);',
      '  float sd = max(dot(d, uSun), 0.0);',
      '  vec3 hd = normalize(vec3(d.x, 0.0, d.z) + vec3(1e-4)), hs = normalize(vec3(uSun.x, 0.0, uSun.z) + vec3(1e-4));',
      '  float toward = clamp(dot(hd, hs), -1.0, 1.0);',
      '  vec3 hz = mix(vec3(0.8, 0.89, 0.98), vec3(0.93, 0.94, 0.97), pow(max(toward, 0.0), 6.0) * 0.6);',
      '  vec3 col = mix(hz, vec3(0.34, 0.63, 0.96), smoothstep(0.0, 0.2, y));',
      '  col = mix(col, vec3(0.07, 0.3, 0.82), smoothstep(0.16, 0.8, y));',
      '  col += vec3(1.0, 0.97, 0.92) * (pow(sd, 10.0) * 0.07 + pow(sd, 80.0) * 0.22);',
      '  float pil = exp(-acos(toward) * 34.0) * exp(-abs(y - uSun.y) * 3.0);',
      '  col += vec3(0.95, 0.95, 1.0) * pil * 0.12;',
      '  return min(col, vec3(1.0));',
      '}',
    ].join('\n');
    /* Le ciel complet. En mode photo : les nuages ondulent doucement (une seule lecture, déformée lentement : l'image reste nette),
       le bleu creusé et saturé (les blancs restent blancs), et le soleil : un disque blanc, un halo, une étoile de rayons fins.
       Un nuage qui passe devant voile le disque, pas l'étoile.
       uHdr > 0 (reflets) : les zones claires dépassent 1, pour que le verre, le disque et l'eau brillent vraiment. */
    s.skyFullGLSL = [
      'uniform sampler2D uClouds; uniform float uCloudRot; uniform sampler2D uSkyTex; uniform float uSkyRot; uniform float uSkyMode;',
      'uniform float uSkyTime; uniform float uHdr;',
      'vec3 photoSky(vec3 dd, float az, float el){',
      /* le bas de la photo (1°) est un sol gris flou : les nuages des 3 derniers degrés y sont tassés jusqu'à l'horizon,
         sans relire une même rangée de pixels (sinon : des stries verticales) */
      '  vec2 uv = vec2(fract(az + uSkyRot), el < 0.05 ? mix(0.012, 0.05 / 1.5707963, el / 0.05) : el / 1.5707963);',
      '  float sd = max(dot(dd, uSun), 0.0);',
      '  vec2 wq = uv * vec2(7.0, 4.0);',
      '  vec2 fl = vec2(noise(wq + vec2(uSkyTime * 0.035, 0.0)), noise(wq + vec2(5.2, 1.3) - vec2(0.0, uSkyTime * 0.03))) - 0.5;',
      '  fl *= vec2(0.0035, 0.0025) * smoothstep(0.9996, 0.985, sd) * smoothstep(0.0, 0.04, uv.y);',
      '  vec3 c = texture2D(uSkyTex, uv + fl).rgb;',
      '  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));',
      /* le bleu se creuse et se sature ; un nuage (gris ou blanc, b ≈ r) n'est pas touché */
      '  float blu = smoothstep(0.03, 0.22, c.b - c.r);',
      '  c = mix(c, mix(vec3(l), c, 1.45) * vec3(0.8, 0.88, 1.0), blu);',
      '  c = mix(c, c * vec3(0.93, 0.97, 1.06), smoothstep(0.65, 0.2, l));',
      '  vec3 t1 = normalize(cross(uSun, vec3(0.0, 1.0, 0.0))), t2 = cross(t1, uSun);',
      '  float ang = atan(dot(dd, t2), dot(dd, t1));',
      '  float a = acos(clamp(dot(dd, uSun), -1.0, 1.0));',
      '  float cl = (1.0 - blu) * smoothstep(0.55, 0.85, l);',
      '  float disk = smoothstep(0.0125, 0.0095, a);',
      '  float halo = exp(-a * a / 0.0005) * 0.75 + exp(-a / 0.035) * 0.3 + exp(-a / 0.16) * 0.1;',
      '  float star = (pow(abs(cos(ang * 3.0)), 260.0) + pow(abs(cos(ang * 3.0 + 0.5236)), 520.0) * 0.45) * exp(-a / 0.075);',
      '  float streak = pow(noise(vec2(ang * 38.0, 1.7)), 4.0) * exp(-a / 0.11) * (0.8 + 0.2 * sin(uSkyTime * 0.6 + ang * 9.0));',
      '  c += uSunCol * (halo * (1.0 - cl * 0.4) + star * 0.3 + streak * 0.15);',
      '  c = mix(c, vec3(1.0, 0.995, 0.98), disk * (1.0 - cl * 0.85));',
      /* l'éclat des reflets de l'eau (uHdr < 0,5) s'éteint vers l'horizon : le reflet y est exactement le ciel, sans marche */
      '  float hk = uHdr < 0.5 ? uHdr * smoothstep(0.02, 0.2, el) : uHdr;',
      '  c += hk * (c * pow(l, 3.0) * 0.9 + uSunCol * (disk * 8.0 + halo * 1.2));',
      '  return c;',
      '}',
      /* La colonne de lumière : le soleil, posé sur l'horizon, lance un pilier blanc-lavande vers le ciel ; étroit au ras de l'eau,
         il s'évase en ailes fibreuses en montant et s'efface. Le miroir d'eau le prolonge vers le bas. */
      'uniform float uPillar;',
      'vec3 sunPillar(vec3 dd, vec3 col, float el){',
      '  vec3 sh = normalize(vec3(uSun.x, 0.0, uSun.z)), hd = normalize(vec3(dd.x, 0.0, dd.z) + vec3(1e-5));',
      '  if (uPillar < 0.5 || dot(hd, sh) < 0.0) return col;',
      '  float px = dot(hd, vec3(-sh.z, 0.0, sh.x));',
      '  float up = max(el - asin(clamp(uSun.y, -1.0, 1.0)), 0.0);',
      '  float pw = 0.008 + 0.07 * up + 0.3 * up * up;',
      '  float fib = 0.6 + 0.4 * noise(vec2(px / pw * 3.0, up * 4.0 - uSkyTime * 0.05));',
      '  float core = exp(-(px * px) / (pw * pw)) * exp(-up / 1.1);',
      '  float wing = exp(-abs(px) / (0.03 + 0.5 * up)) * smoothstep(0.0, 0.15, up) * exp(-up / 1.0) * 0.45;',
      '  float pil = (core * 0.8 + wing) * fib * (0.92 + 0.08 * sin(uSkyTime * 0.4));',
      '  vec3 pc = mix(uSunCol, vec3(0.93, 0.91, 1.0), 0.55);',
      '  return col + pc * pil * (1.0 + uHdr * 1.5);',
      '}',
      'vec3 skyFull(vec3 d){',
      '  vec3 dd = vec3(d.x, abs(d.y), d.z);',
      '  float el = asin(clamp(dd.y, 0.0, 1.0));',
      '  float az = atan(dd.x, dd.z) / 6.2831853 + 0.5;',
      '  vec3 col;',
      '  if (uSkyMode > 0.5) {',
      '    col = photoSky(dd, az, el);',
      '  } else {',
      '    col = skyCol(dd);',
      '    col = mix(col, vec3(1.0, 0.99, 0.96), smoothstep(0.99955, 0.9998, dot(dd, uSun)));',
      '    if (el < 0.62) {',
      '      vec4 cl = texture2D(uClouds, vec2(fract(az + uCloudRot), el / 0.62));',
      '      col = mix(col, cl.rgb, cl.a * smoothstep(0.62, 0.5, el));',
      '    }',
      '  }',
      '  col = sunPillar(dd, col, el);',
      '  if (d.y < 0.0) col *= mix(vec3(1.0), vec3(0.95, 0.97, 0.98), smoothstep(0.0, 0.1, -d.y));',
      '  return col;',
      '}',
    ].join('\n');

    /* Les nuages peints ne sont faits que si la photo manque : une bande panoramique (360°, de l'horizon à 35° de haut). */
    s.makeClouds = () => {
      const big = (renderer.capabilities.maxTextureSize || 4096) >= 8192 && (window.screen ? window.screen.width : 1440) > 700;
      const cloudTex = s.cloudTex = new THREE.CanvasTexture(this.paintClouds(big ? 8192 : 4096, big ? 1024 : 512, 0.62, Math.PI + 0.17));
      cloudTex.wrapS = THREE.RepeatWrapping; cloudTex.wrapT = THREE.ClampToEdgeWrapping;
      cloudTex.generateMipmaps = false; cloudTex.minFilter = THREE.LinearFilter; cloudTex.magFilter = THREE.LinearFilter;
      s.uClouds.value = cloudTex;
      s.envAt = -99; s.cubeAt = -99;
    };

    const hemi = s.hemi = new THREE.HemisphereLight(0xeef4fb, 0xf2ece2, HEMI);
    scene.add(hemi);
    const sun = s.sun = new THREE.DirectionalLight(0xfff6ea, SUN);
    scene.add(sun); scene.add(sun.target);

    const skyShader = (hdr) => new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: this.skyUniforms(s, hdr),
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: [
        'varying vec3 vDir; uniform float uTime; uniform float uMist; uniform vec3 uMistCol;', s.noiseGLSL, s.skyGLSL, s.skyFullGLSL,
        'void main(){',
        '  vec3 col = mix(skyFull(normalize(vDir)), uMistCol, uMist);',
        '  gl_FragColor = linearToOutputTexel(vec4(toLin(col), 1.0));',
        '}',
      ].join('\n'),
    });
    const sky = s.sky = new THREE.Mesh(new THREE.SphereGeometry(4500, 48, 24), skyShader(0));
    sky.frustumCulled = false; sky.renderOrder = -1;
    scene.add(sky);

    /* Le ciel en cube, pour les reflets du verre et du disque, en valeurs « HDR » : recalculé de temps en temps pendant que les nuages bougent. */
    const envScene = s.envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), skyShader(1)));
    const skyRT = s.skyRT = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const cubeCam = new THREE.CubeCamera(0.1, 200, skyRT);
    s.updateSky = () => { try { cubeCam.update(renderer, envScene); } catch (e) { /* rien */ } };

    /* L'eau, à perte de vue : un miroir presque parfait (façon salar d'Uyuni) qui reflète les nuages,
       à peine ridé, turquoise au-dessus du sable autour de l'îlot, et quelques éclats sous le soleil. */
    const IS = this.isle(), DN = 128, DB = 6;
    const dd = new Uint8Array(DN * DN * 4);
    for (let j = 0; j < DN; j++) for (let i = 0; i < DN; i++) {
      const x = IS.x - DB + (i + 0.5) / DN * 2 * DB, z = IS.z - DB + (j + 0.5) / DN * 2 * DB;
      const v = Math.round(Math.max(0, Math.min(1, (WY - this.islandH(x, z)) / 0.8)) * 255), k = (j * DN + i) * 4;
      dd[k] = v; dd[k + 1] = v; dd[k + 2] = v; dd[k + 3] = 255;
    }
    const depthTex = s.depthTex = new THREE.DataTexture(dd, DN, DN, THREE.RGBAFormat);
    depthTex.magFilter = THREE.LinearFilter; depthTex.minFilter = THREE.LinearFilter; depthTex.needsUpdate = true;
    const waterMat = new THREE.ShaderMaterial({
      fog: false,
      uniforms: Object.assign(this.skyUniforms(s, 0.05), {
        uAer: s.uAer, uDepth: { value: depthTex }, uIsle: { value: new THREE.Vector3(IS.x - DB, IS.z - DB, 2 * DB) },
      }),
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: [
        'varying vec3 vW; uniform float uTime; uniform float uMist; uniform vec3 uMistCol; uniform float uAer;',
        'uniform sampler2D uDepth; uniform vec3 uIsle;',
        s.noiseGLSL, s.skyGLSL, s.skyFullGLSL,
        'void main(){',
        '  vec3 V = vW - cameraPosition; float dist = length(V); V /= dist;',
        '  vec2 p = vW.xz;',
        /* vers l'horizon la surface devient parfaitement plate : sinon chaque pixel lit le ciel à un endroit différent
           et la carte graphique prend une version floue de l'image. Plate, elle renvoie le ciel net jusqu'à l'infini. */
        '  float near = 1.0 / (1.0 + dist * 0.15) * smoothstep(0.015, 0.12, -V.y);',
        /* houle très lente et rides très fines : la surface reste un miroir */
        '  vec2 g = vec2(0.6, 0.8) * cos(dot(p, vec2(0.6, 0.8)) * 1.1 + uTime * 0.55) * 0.6',
        '         + vec2(-0.75, 0.35) * cos(dot(p, vec2(-0.75, 0.35)) * 1.9 + uTime * 0.8) * 0.35;',
        '  vec2 q = p * 2.6 + vec2(uTime * 0.22, uTime * 0.1);',
        '  float n0 = noise(q), nx = noise(q + vec2(0.06, 0.0)), nz = noise(q + vec2(0.0, 0.06));',
        '  g += vec2(nx - n0, nz - n0) / 0.06 * 0.25;',
        '  vec3 N = normalize(vec3(-g.x * 0.0045 * near, 1.0, -g.y * 0.0045 * near));',
        '  vec3 R = reflect(V, N); R = normalize(vec3(R.x, abs(R.y) + 0.002, R.z));',
        '  vec3 refl = toLin(skyFull(vec3(R.x, -R.y, R.z)) * mix(vec3(1.0), vec3(0.95, 0.97, 1.0), smoothstep(0.0, 0.1, R.y)));',
        '  float cosT = clamp(dot(-V, N), 0.0, 1.0);',
        '  float fres = 0.8 + 0.2 * pow(1.0 - cosT, 4.0);',
        /* le fond : sable clair sous l'eau près de l'îlot, turquoise, puis bleu profond */
        '  vec2 uv = (p - uIsle.xy) / uIsle.z;',
        '  float dep = (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) ? texture2D(uDepth, uv).r : 1.0;',
        '  vec3 body = mix(toLin(vec3(0.86, 0.86, 0.8)), toLin(vec3(0.42, 0.78, 0.8)), smoothstep(0.0, 0.1, dep));',
        '  body = mix(body, toLin(vec3(0.04, 0.3, 0.55)), smoothstep(0.06, 0.6, dep));',
        '  float clear = 1.0 - smoothstep(0.0, 0.3, dep);',
        '  vec3 col = mix(body, refl, fres * (1.0 - clear * 0.55));',
        /* un liseré d'eau claire qui respire au bord du sable */
        '  float lap = 0.5 + 0.5 * sin(uTime * 0.7 + noise(p * 3.0) * 5.0);',
        '  col = mix(col, toLin(vec3(0.98, 0.98, 0.96)), smoothstep(0.03, 0.0, dep) * (0.25 + 0.35 * lap));',
        /* le chemin de lumière : un halo doux et des milliers de petits éclats, de la couleur du soleil */
        '  vec2 q2 = p * 15.0 + vec2(uTime * 0.9, -uTime * 0.7);',
        '  float m0 = noise(q2), mx = noise(q2 + vec2(0.05, 0.0)), mz = noise(q2 + vec2(0.0, 0.05));',
        '  vec3 Ng = normalize(vec3(-(g.x * 0.08 + (mx - m0) / 0.05 * 0.06), 1.0, -(g.y * 0.08 + (mz - m0) / 0.05 * 0.06)));',
        '  float sp = max(dot(reflect(V, Ng), uSun), 0.0), sp0 = max(dot(R, uSun), 0.0);',
        '  col += toLin(uSunCol) * (pow(sp, 900.0) * 30.0 * smoothstep(4.0, 14.0, dist) + pow(sp0, 90.0) * 0.3 + pow(sp0, 10.0) * 0.03);',
        /* au loin, l'eau devient un miroir parfait : le reflet exact du ciel, qui le rejoint sans couture (effet infini) */
        '  float fa = 1.0 - exp(-dist * uAer * 3.0);',
        '  col = mix(col, toLin(skyFull(V)), fa);',
        '  col = mix(col, toLin(uMistCol), uMist);',
        '  gl_FragColor = linearToOutputTexel(vec4(col, 1.0));',
        '}',
      ].join('\n'),
    });
    s.waterMat = waterMat;
    const water = new THREE.Mesh(new THREE.CircleGeometry(4000, 96), waterMat);
    water.rotation.x = -Math.PI / 2; water.position.y = WY; water.frustumCulled = false;
    scene.add(water);

    /* L'îlot : un banc de sable blanc à peine sorti de l'eau, plus sombre là où il est mouillé. */
    const IR = 70, ISEG = 200, ipos = new Float32Array((IR + 1) * ISEG * 3), icol = new Float32Array((IR + 1) * ISEG * 3);
    for (let i = 0; i <= IR; i++) {
      const q = Math.pow(i / IR, 1.15) * 1.9;
      for (let j = 0; j < ISEG; j++) {
        const a = (j / ISEG) * Math.PI * 2, e = this.isleEdge(a);
        const x = IS.x + Math.cos(a) * q * e * IS.rx, z = IS.z + Math.sin(a) * q * e * IS.rz;
        const h = this.islandH(x, z), o = (i * ISEG + j) * 3;
        ipos[o] = x; ipos[o + 1] = h; ipos[o + 2] = z;
        const wet = this.smooth(-0.025, -0.1, h), k = (1 + (this.fbm2(x * 1.7, z * 1.7) - 0.5) * 0.08) * (1 - wet * 0.28);
        icol[o] = ALB.r * k * (1 - wet * 0.08); icol[o + 1] = ALB.g * k; icol[o + 2] = ALB.b * k * (1 + wet * 0.05);
      }
    }
    const iidx = [];
    for (let i = 0; i < IR; i++) for (let j = 0; j < ISEG; j++) {
      const a = i * ISEG + j, b = i * ISEG + (j + 1) % ISEG, c2 = (i + 1) * ISEG + j, d2 = (i + 1) * ISEG + (j + 1) % ISEG;
      iidx.push(a, b, c2, b, d2, c2);
    }
    const ig = new THREE.BufferGeometry();
    ig.setAttribute('position', new THREE.BufferAttribute(ipos, 3));
    ig.setAttribute('color', new THREE.BufferAttribute(icol, 3));
    ig.setIndex(iidx);
    ig.computeVertexNormals();
    const isleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, fog: false });
    isleMat.onBeforeCompile = (sh) => this.patchGround(sh, s, false);
    const isleMesh = new THREE.Mesh(ig, isleMat);
    isleMesh.position.y = -0.004;
    scene.add(isleMesh);

    /* Le tas de sable qui recouvre le bas de la cartouche. */
    const hg = new THREE.CircleGeometry(1, 56);
    hg.rotateX(-Math.PI / 2);
    const hp = hg.attributes.position;
    for (let i = 0; i < hp.count; i++) {
      const x = hp.getX(i), z = hp.getZ(i), rr = x * x + z * z;
      const a = Math.atan2(z, x), edge = 0.82 + 0.18 * this.fbm2(Math.cos(a) * 2 + 5, Math.sin(a) * 2 + 5);
      hp.setY(i, 0.12 * Math.pow(Math.max(0, 1 - rr / (edge * edge)), 1.8) * (0.8 + 0.4 * this.fbm2(x * 3 + 4, z * 3 + 1)));
    }
    hg.computeVertexNormals();
    const hn = hg.attributes.normal;
    for (let i = 0; i < hn.count; i++) { const nv = new THREE.Vector3(hn.getX(i) * 0.45, 0.55 + hn.getY(i) * 0.45, hn.getZ(i) * 0.45).normalize(); hn.setXYZ(i, nv.x, nv.y, nv.z); }
    const heapMat = new THREE.MeshStandardMaterial({ color: ALB, roughness: 1, metalness: 0, fog: false });
    heapMat.onBeforeCompile = (sh) => this.patchGround(sh, s, false);
    const heap = s.heapMesh = new THREE.Mesh(hg, heapMat);
    heap.position.set(-1.4, -0.002, 0.32); heap.rotation.y = 0.45; heap.scale.set(1.0, 1, 0.46);
    scene.add(heap);

    const mkCanvas = (sz) => { const c = document.createElement('canvas'); c.width = sz; c.height = sz; return c; };

    /* Ombre douce de la cartouche quand elle flotte. */
    const multiply = { transparent: true, depthWrite: false, blending: THREE.MultiplyBlending, premultipliedAlpha: true, fog: false };
    const shadowMat = s.shadowMat = new THREE.ShaderMaterial(Object.assign({
      uniforms: { uStrength: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: [
        'varying vec2 vUv; uniform float uStrength;',
        'void main(){ vec2 q = (vUv - 0.5) * 2.0; float d = dot(q, q);',
        '  gl_FragColor = vec4(vec3(1.0 - uStrength * exp(-d * 3.2)), 1.0); }',
      ].join('\n'),
    }, multiply));
    const shadow = s.shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.9), shadowMat);
    shadow.rotation.x = -Math.PI / 2; shadow.position.set(hb.x, 0.075, hb.z); shadow.renderOrder = 1;
    scene.add(shadow);

    /* La cartouche : un bloc de verre liquide. Bords arrondis qui tordent la lumière, reflets du ciel,
       une pointe de bleu du collier dans la masse, et le DVD pris à l'intérieur du verre. */
    const cover = s.cover = new THREE.Group();
    cover.rotation.order = 'YXZ';
    scene.add(cover);
    const BS = 0.13, BT = 0.065, GD = 0.02, hs = HS - BS, cc = C * 0.7;
    const glassShape = new THREE.Shape([[-hs, -hs + cc], [-hs + cc, -hs], [hs, -hs], [hs, hs - cc], [hs - cc, hs], [-hs, hs]].map((q) => new THREE.Vector2(q[0], q[1])));
    const glassGeo = new THREE.ExtrudeGeometry(glassShape, { depth: GD, bevelEnabled: true, bevelSize: BS, bevelThickness: BT, bevelSegments: 14, curveSegments: 1 });
    glassGeo.translate(0, 0, -GD / 2);
    this.smoothNormals(glassGeo, 0.95);
    const glassMat = s.glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0, roughness: 0.03, transmission: 1, thickness: 0.8, ior: 1.5,
      attenuationColor: new THREE.Color(0xd7eef6).convertSRGBToLinear(), attenuationDistance: 7,
      specularIntensity: 0.9, envMapIntensity: 0.65, fog: false,
    });
    /* Le liseré lumineux des bords, typique du verre liquide : plus la surface fuit le regard, plus elle s'éclaire. */
    glassMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <output_fragment>', [
        '  float rimF = 1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);',
        '  outgoingLight += vec3(1.0, 0.95, 0.9) * pow(rimF, 3.0) * 0.3;',
        '#include <output_fragment>',
      ].join('\n'));
    };
    const glass = new THREE.Mesh(glassGeo, glassMat);
    cover.add(glass);
    /* Le DVD, pris dans le verre : face imprimée blanche (le collier et ses perles, le logo), face gravée irisée.
       Il reste immobile dans la cartouche. */
    const DR = 0.5, DT = 0.012, HOLE = DR * 0.125;
    const discCv = mkCanvas(2048);
    const discTex = new THREE.CanvasTexture(discCv); discTex.anisotropy = aniso; discTex.encoding = THREE.sRGBEncoding;
    const disc = new THREE.Group(); cover.add(disc);
    const topMat = s.topMat = new THREE.MeshStandardMaterial({ map: discTex, emissiveMap: discTex, emissive: new THREE.Color(0.42, 0.42, 0.42), color: new THREE.Color(0.62, 0.62, 0.62), roughness: 0.3, metalness: 0, envMapIntensity: 0.35 });
    const discTop = new THREE.Mesh(new THREE.RingGeometry(HOLE, DR, 128, 1), topMat);
    discTop.position.z = DT / 2; disc.add(discTop);
    const dataMat = s.dataMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0.86, 0.88, 0.9), metalness: 1, roughness: 0.16,
      iridescence: 1, iridescenceIOR: 1.8, iridescenceThicknessRange: [250, 700], envMapIntensity: 1.2,
    });
    const discBack = new THREE.Mesh(new THREE.RingGeometry(HOLE, DR, 128, 1), dataMat);
    discBack.rotation.y = Math.PI; discBack.position.z = -DT / 2; disc.add(discBack);
    const rimMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.78, 0.8, 0.82), metalness: 0.6, roughness: 0.3 });
    const discRim = new THREE.Mesh(new THREE.CylinderGeometry(DR, DR, DT, 128, 1, true), rimMat);
    discRim.rotation.x = Math.PI / 2; disc.add(discRim);
    const holeRim = new THREE.Mesh(new THREE.CylinderGeometry(HOLE, HOLE, DT, 48, 1, true), new THREE.MeshStandardMaterial({ color: new THREE.Color(0.85, 0.86, 0.87), roughness: 0.3, side: THREE.BackSide }));
    holeRim.rotation.x = Math.PI / 2; disc.add(holeRim);
    s.pickables = [glass, discTop, discBack];

    /* Reflets du verre et du disque : tirés du même ciel en cube. */
    s.pmrem = new THREE.PMREMGenerator(renderer);
    s.updateEnv = () => {
      try {
        const rt = s.pmrem.fromCubemap(skyRT.texture);
        const first = !s.envRT;
        if (s.envRT) s.envRT.dispose();
        s.envRT = rt;
        [glassMat, dataMat, topMat].forEach((m) => { m.envMap = rt.texture; if (first) m.needsUpdate = true; });
      } catch (e) { /* rien */ }
    };

    const draw = (logo) => { this.drawDisc(discCv.getContext('2d'), 2048, logo); discTex.needsUpdate = true; };
    s.logo = null;
    draw(null);
    const logoImg = new Image();
    logoImg.onload = () => { if (this._s === s) { s.logo = logoImg; draw(logoImg); } };
    logoImg.src = ASSETS.logo;

    /* Particules : grain doux et rond, partagé par toutes les nuées. */
    const dotCv = mkCanvas(64), dx = dotCv.getContext('2d'), grad = dx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.75)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    dx.fillStyle = grad; dx.fillRect(0, 0, 64, 64);
    const dotTex = new THREE.CanvasTexture(dotCv);
    const lin = (h) => new THREE.Color(h).convertSRGBToLinear();
    const mkPoints = (N, size, palette, order) => {
      const pos = new Float32Array(N * 3), col = new Float32Array(N * 4);
      for (let i = 0; i < N; i++) { const c = palette[(Math.random() * palette.length) | 0]; col[i * 4] = c.r; col[i * 4 + 1] = c.g; col[i * 4 + 2] = c.b; col[i * 4 + 3] = 0; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 4));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ size, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }));
      pts.frustumCulled = false; pts.renderOrder = order;
      scene.add(pts);
      return { N, pos, col, geo: g };
    };
    /* 1. de petites lumières qui flottent au-dessus de l'eau et montent doucement */
    s.p = mkPoints(420, 0.022, [lin(0xffffff), lin(0xfff1dc), lin(0xbfe3ef), lin(0xf5ead2), lin(0xffd9b0)], 3);
    s.p.base = new Float32Array(s.p.N * 4);
    for (let i = 0; i < s.p.N; i++) {
      s.p.base[i * 4] = (Math.random() * 2 - 1) * 3.2; s.p.base[i * 4 + 1] = Math.random();
      s.p.base[i * 4 + 2] = (Math.random() * 2 - 1) * 2.6 - 0.2; s.p.base[i * 4 + 3] = Math.random() * Math.PI * 2;
    }
    /* 2. grains clairs qui montent de la cartouche tant qu'elle attend d'être dégagée */
    s.l = mkPoints(110, 0.028, [lin(0xfff6e6), lin(0x2b95c4), lin(0xe9dcc6)], 4);
    s.l.base = new Float32Array(s.l.N * 4);
    for (let i = 0; i < s.l.N; i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * 0.7;
      s.l.base[i * 4] = -1.4 + Math.cos(a) * rr; s.l.base[i * 4 + 1] = Math.random();
      s.l.base[i * 4 + 2] = 0.28 + Math.sin(a) * rr * 0.6; s.l.base[i * 4 + 3] = Math.random() * Math.PI * 2;
    }
    /* 3. gerbes de sable du déblayage, et les nuages de poussière qui les suivent */
    s.b = mkPoints(1100, 0.04, [lin(0xc4b090), lin(0xb39d7e), lin(0xd8c8ad), lin(0x9c8566)], 3);
    s.b.vel = new Float32Array(s.b.N * 3); s.b.life = new Float32Array(s.b.N); s.b.max = new Float32Array(s.b.N); s.b.next = 0; s.b.amax = 0.9;
    s.q = mkPoints(60, 0.6, [lin(0xcbb795), lin(0xd6c4a5), lin(0xbfa982)], 2);
    s.q.vel = new Float32Array(s.q.N * 3); s.q.life = new Float32Array(s.q.N); s.q.max = new Float32Array(s.q.N); s.q.next = 0; s.q.amax = 0.22;

    this.updateDust(s, false);
    this.buildCollier(s);

    /* Glisser pour tourner autour ; un simple clic sur la cartouche la dégage. */
    s.onDown = (e) => {
      s.drag.on = true; s.drag.x = e.clientX; s.drag.y = e.clientY; s.drag.vel = 0; s.drag.lt = performance.now();
      s.drag.downT = s.drag.lt; s.drag.moved = 0;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* rien */ }
    };
    s.onDrag = (e) => {
      if (!s.drag.on) {
        if (!s.hoverTick) {
          s.hoverTick = true;
          requestAnimationFrame(() => { s.hoverTick = false; if (this._s === s) canvas.style.cursor = this.pickCover(s, e.clientX, e.clientY) ? 'pointer' : ''; });
        }
        return;
      }
      const now = performance.now();
      const d = ((e.clientX - s.drag.x) / Math.max(320, s.W)) * 2.6;
      s.drag.moved += Math.abs(e.clientX - s.drag.x) + Math.abs(e.clientY - s.drag.y);
      s.drag.x = e.clientX; s.drag.y = e.clientY; s.drag.off += d;
      const ddt = Math.max(0.008, (now - s.drag.lt) / 1000);
      s.drag.vel = Math.max(-6, Math.min(6, s.drag.vel * 0.6 + (d / ddt) * 0.4));
      s.drag.lt = now;
    };
    s.onUp = (e) => {
      if (!s.drag.on) return;
      s.drag.on = false;
      s.drag.off = Math.atan2(Math.sin(s.drag.off), Math.cos(s.drag.off));
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* rien */ }
      if (e.type === 'pointerup' && s.drag.moved < 8 && performance.now() - s.drag.downT < 700 && this.pickCover(s, e.clientX, e.clientY)) app.onCoverClick();
    };
    canvas.addEventListener('pointerdown', s.onDown);
    canvas.addEventListener('pointermove', s.onDrag);
    canvas.addEventListener('pointerup', s.onUp);
    canvas.addEventListener('pointercancel', s.onUp);

    s.resize = () => {
      const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
      s.W = w; s.H = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    s.resize();
    if (window.ResizeObserver) { s.ro = new ResizeObserver(() => s.resize()); s.ro.observe(canvas); }
    else window.addEventListener('resize', s.resize);

    s.raf = requestAnimationFrame(this.frame);
  }

  /* Le collier : géométrie binaire (positions, uv, indices), trois textures JPEG ; le ciel photo se charge avec lui. */
  async buildCollier(s) {
    const app = this.app;
    let left = 4, done = false;
    const finish = () => {
      if (this._s !== s || done) return;
      done = true;
      try { s.renderer.compile(s.scene, s.camera); } catch (e) { /* rien */ }
      app.onModelReady(false);
    };
    const step = () => { left--; app.onProgress(35 + (4 - left) * 16); if (left <= 0) finish(); };
    this.ensureSky(s, step);

    let buf;
    try {
      const res = await fetch(ASSETS.model);
      if (!res.ok) throw new Error(res.status);
      buf = await res.arrayBuffer();
    } catch (e) {
      app.onModelReady(true);
      return;
    }
    if (this._s !== s) return;
    const head = new DataView(buf, 0, 8), count = head.getUint32(0, true), nIdx = head.getUint32(4, true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, 8, count * 3), 3));
    const uv = new THREE.BufferAttribute(new Float32Array(buf, 8 + count * 12, count * 2), 2);
    g.setAttribute('uv', uv);
    g.setAttribute('uv2', uv);
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(buf, 8 + count * 20, nIdx), 1));
    g.computeVertexNormals();
    const loader = new THREE.TextureLoader();
    const tex = (url, srgb) => {
      const t = loader.load(url, step, undefined, step);
      t.flipY = false; t.anisotropy = s.aniso;
      if (srgb) t.encoding = THREE.sRGBEncoding;
      return t;
    };
    const mat = new THREE.MeshStandardMaterial({
      map: tex(ASSETS.base, true), normalMap: tex(ASSETS.normal, false), aoMap: tex(ASSETS.ao, false),
      roughness: 1, metalness: 0, aoMapIntensity: 0.45, fog: false,
    });
    mat.normalScale.set(1, -1);
    mat.onBeforeCompile = (sh) => this.patchGround(sh, s, true);
    const mesh = new THREE.Mesh(g, mat);
    mesh.scale.setScalar(1.4);
    s.scene.add(mesh);
    s.model = mesh;
    app.onProgress(35);
  }

  pickCover(s, cx, cy) {
    if (!s.cover) return false;
    const rect = s.canvas.getBoundingClientRect();
    if (!rect.width) return false;
    const nx = ((cx - rect.left) / rect.width) * 2 - 1, ny = -(((cy - rect.top) / rect.height) * 2 - 1);
    s.ray.setFromCamera({ x: nx, y: ny }, s.camera);
    if (s.ray.intersectObjects(s.pickables, false).length) return true;
    const v = s.tmp2.setFromMatrixPosition(s.cover.matrixWorld).project(s.camera);
    return Math.hypot((v.x - nx) * rect.width / 2, (v.y - ny) * rect.height / 2) < 70;
  }

  emit(s, x, y, z, vx, vy, vz, life, sys) {
    const b = sys || s.b, i = b.next;
    b.next = (i + 1) % b.N;
    b.pos[i * 3] = x; b.pos[i * 3 + 1] = y; b.pos[i * 3 + 2] = z;
    b.vel[i * 3] = vx; b.vel[i * 3 + 1] = vy; b.vel[i * 3 + 2] = vz;
    b.life[i] = life; b.max[i] = life;
  }
  /* Le sable s'écarte doucement : quelques grains roulent et retombent, un voile de poussière s'élève et dérive avec le vent. */
  emitBurst(s) {
    const hm = s.heapMesh, cy = Math.cos(hm.rotation.y), sy = Math.sin(hm.rotation.y);
    for (let i = 0; i < 220; i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random());
      const lx = Math.cos(a) * rr * hm.scale.x, lz = Math.sin(a) * rr * hm.scale.z;
      const x = hm.position.x + lx * cy + lz * sy, z = hm.position.z - lx * sy + lz * cy;
      const ox = Math.cos(a) * cy + Math.sin(a) * sy, oz = -Math.cos(a) * sy + Math.sin(a) * cy;
      const sp = 0.12 + Math.random() * 0.4;
      this.emit(s, x, 0.02 + Math.random() * 0.08, z, ox * sp + 0.08, 0.3 + Math.random() * 0.7, oz * sp, 1.8 + Math.random() * 1.4);
    }
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * 0.8;
      const lx = Math.cos(a) * rr * hm.scale.x, lz = Math.sin(a) * rr * hm.scale.z;
      const sp = 0.1 + Math.random() * 0.25;
      this.emit(s, hm.position.x + lx * cy + lz * sy, 0.06 + Math.random() * 0.12, hm.position.z - lx * sy + lz * cy,
        Math.cos(a) * sp + 0.12, 0.12 + Math.random() * 0.25, Math.sin(a) * sp, 3.2 + Math.random() * 1.6, s.q);
    }
  }
  updateBurst(s, dt) {
    this.updateFalling(s.b, dt, 4.2, 0.9);
    this.updateFalling(s.q, dt, 0.15, 1.6);
  }
  updateFalling(b, dt, grav, dragK) {
    for (let i = 0; i < b.N; i++) {
      if (b.life[i] <= 0) { b.col[i * 4 + 3] = 0; continue; }
      b.life[i] -= dt;
      const k = i * 3, drag = Math.exp(-dragK * dt);
      b.vel[k + 1] -= grav * dt;
      b.vel[k] *= drag; b.vel[k + 1] *= drag; b.vel[k + 2] *= drag;
      b.pos[k] += b.vel[k] * dt; b.pos[k + 1] += b.vel[k + 1] * dt; b.pos[k + 2] += b.vel[k + 2] * dt;
      if (b.pos[k + 1] < 0.006) { b.pos[k + 1] = 0.006; b.vel[k + 1] = 0; b.vel[k] *= 0.6; b.vel[k + 2] *= 0.6; }
      b.col[i * 4 + 3] = b.amax * Math.min(1, b.life[i] / 0.7) * Math.min(1, (b.max[i] - b.life[i]) / 0.08);
    }
    b.geo.attributes.position.needsUpdate = true;
    b.geo.attributes.color.needsUpdate = true;
  }

  updateDust(s, playing) {
    const p = s.p, Hh = 2.1, rise = playing ? 0.05 : 0.018, t = s.t;
    for (let i = 0; i < p.N; i++) {
      const b = i * 4, w = p.base[b + 3];
      const u = (p.base[b + 1] + t * rise * (0.6 + (i % 7) * 0.08)) % 1;
      p.pos[i * 3] = p.base[b] + Math.sin(t * 0.21 + w) * 0.12 + Math.sin(t * 0.07 + w * 2.0) * 0.2;
      p.pos[i * 3 + 1] = 0.02 + u * Hh;
      p.pos[i * 3 + 2] = p.base[b + 2] + Math.cos(t * 0.17 + w * 1.3) * 0.14;
      p.col[b + 3] = 0.5 * Math.min(1, u / 0.12) * Math.min(1, (1 - u) / 0.3);
    }
    p.geo.attributes.position.needsUpdate = true;
    p.geo.attributes.color.needsUpdate = true;
  }
  /* L'appel : des grains clairs montent doucement au-dessus de la cartouche enfouie. */
  updateLure(s, rm) {
    const l = s.l, t = rm ? 0 : s.t, amt = Math.max(0, s.halo);
    for (let i = 0; i < l.N; i++) {
      const b = i * 4, w = l.base[b + 3];
      const u = (l.base[b + 1] + t * 0.09 * (0.7 + (i % 5) * 0.1)) % 1;
      l.pos[i * 3] = l.base[b] + Math.sin(t * 0.5 + w) * 0.06;
      l.pos[i * 3 + 1] = 0.05 + u * 1.1;
      l.pos[i * 3 + 2] = l.base[b + 2] + Math.cos(t * 0.4 + w * 1.7) * 0.06;
      l.col[b + 3] = amt * 0.8 * Math.min(1, u / 0.15) * Math.pow(1 - u, 1.5);
    }
    l.geo.attributes.position.needsUpdate = true;
    l.geo.attributes.color.needsUpdate = true;
  }

  /* La lumière suit le ciel affiché. */
  applyLight(s, key) {
    const L = LIGHT[key];
    s.sun.color.setHex(L.sun);
    s.hemi.color.setHex(L.sky);
    s.hemi.groundColor.setHex(L.ground);
    s.uSunCol.value.set(L.sunCol[0], L.sunCol[1], L.sunCol[2]);
  }

  frame(now) {
    const s = this._s;
    if (!s) return;
    s.raf = requestAnimationFrame(this.frame);
    // Onglet caché : on ne dessine rien, mais on garde le fil du temps propre.
    if (document.hidden) { s.last = 0; return; }
    const app = this.app;
    const dt = s.last ? Math.min(0.05, (now - s.last) / 1000) : 0.016;
    s.last = now; s.t += dt;
    const rm = s.reduced;
    const sec = app.camSec();
    const playing = app.isPlaying();
    const intro = app.intro, phase = app.phase;
    const loading = intro && phase === 'loading', pano = intro && phase === 'panorama', gate = intro && phase === 'gate';
    /* Le déblayage suit sa propre horloge : il se termine en douceur même si le menu apparaît déjà. */
    const UD = this.unearthDur();
    const tu = intro && s.unearthAt != null ? s.t - s.unearthAt : 99;
    const lifting = !rm && tu < UD;
    const c = s.cam, cv = s.cv;
    const camKeys = ['tx', 'ty', 'tz', 'th', 'ph', 'r', 'fx', 'fy', 'cry', 'crx'];
    const covKeys = ['x', 'y', 'z', 'rx', 'ry', 'rz'];

    if (s.burstPending) { s.burstPending = false; if (!rm) this.emitBurst(s); }

    /* Caméra : brume → panorama → gros plan sur la cartouche, où elle reste.
       Les grands passages sont des fondus à durée fixe ; ensuite des ressorts doux pour les changements de section. */
    let P, w;
    if (loading || gate) { P = this.introPose(); w = 1.2; }
    else if (pano) { P = this.panoramaPose(s.t - (s.panoAt == null ? s.t : s.panoAt), s.W, s.H); w = 1.0; }
    else { P = this.poseFor(sec, s.W, s.H); w = 1.6; }
    const tw = s.tw, twp = tw ? (s.t - tw.t0) / tw.dur : 1;
    if (rm) camKeys.forEach((k) => { c[k] = P[k]; c[k + 'V'] = 0; });
    else if (tw && twp < 1) {
      const e = this.ease(twp);
      camKeys.forEach((k) => {
        const a = tw.from[k];
        c[k] = k === 'th' ? a + this.angDiff(P[k], a) * e : a + (P[k] - a) * e;
        c[k + 'V'] = 0;
      });
    } else {
      s.tw = null;
      camKeys.forEach((k) => { if (k === 'th') this.springAngle(c, k, P[k], w, dt); else this.spring(c, k, P[k], w, dt); });
    }

    /* La brume suit la distance : le sujet reste net, l'horizon se fond dans le ciel ; plus légère pendant le panorama. */
    const fogT = loading ? 0.5 : (pano || gate ? 0.014 : 0.29 / Math.max(0.5, c.r));
    s.fogD += (fogT - s.fogD) * (rm ? 1 : 1 - Math.exp(-dt * 1.4));
    s.scene.fog.density = s.fogD;

    const km = rm ? 1 : 1 - Math.exp(-dt * 1.4);
    s.m.x += ((rm ? 0 : app.mouse.x) - s.m.x) * km;
    s.m.y += ((rm ? 0 : app.mouse.y) - s.m.y) * km;
    if (!s.drag.on) {
      s.drag.off += s.drag.vel * dt;
      s.drag.vel *= Math.exp(-dt * 2.4);
      s.drag.off += (0 - s.drag.off) * (1 - Math.exp(-dt * 0.8));
    }

    /* Respiration : la caméra n'est jamais tout à fait immobile. */
    const th = c.th + s.m.x * 0.06 + s.drag.off + (rm ? 0 : Math.sin(s.t * 0.13) * 0.02);
    const ph = Math.max(0.05, Math.min(1.5, c.ph + s.m.y * 0.025 + (rm ? 0 : Math.sin(s.t * 0.17 + 1.3) * 0.01)));
    const r = c.r * (1 + (rm ? 0 : Math.sin(s.t * 0.11 + 0.4) * 0.008));
    const T = s.target.set(c.tx, c.ty, c.tz);
    const cam = s.camera;
    cam.position.set(T.x + r * Math.cos(ph) * Math.sin(th), T.y + r * Math.sin(ph), T.z + r * Math.cos(ph) * Math.cos(th));
    cam.position.y = Math.max(cam.position.y, this.hAt(s, cam.position.x, cam.position.z) + 0.45);
    cam.lookAt(T);
    cam.setViewOffset(s.W, s.H, (0.5 - c.fx) * s.W, (0.5 - c.fy) * s.H, s.W, s.H);
    cam.updateMatrixWorld();
    s.sky.position.copy(cam.position);

    /* La cartouche : enfouie → elle sort du sable et vient se poser devant toi, d'un seul geste. Ensuite elle reste en main. */
    const held = this.heldCover(s, c, rm);
    if (lifting) {
      const pc = this.ease((tu - 0.05) / (UD - 0.05)), B = this.coverBuried(), L = this.coverLifted();
      covKeys.forEach((k) => { cv[k] = (1 - pc) * (1 - pc) * B[k] + 2 * (1 - pc) * pc * L[k] + pc * pc * held[k]; cv[k + 'V'] = 0; });
    } else {
      const CP = (loading || gate || pano) ? this.coverBuried() : held;
      if (rm) covKeys.forEach((k) => { cv[k] = CP[k]; cv[k + 'V'] = 0; });
      else covKeys.forEach((k) => { if (k[0] === 'r') this.springAngle(cv, k, CP[k], 2.2, dt); else this.spring(cv, k, CP[k], 2.2, dt); });
    }
    s.cover.position.set(cv.x, cv.y, cv.z);
    s.cover.rotation.set(cv.rx, cv.ry, cv.rz);
    s.cover.updateMatrixWorld();

    /* Un filet de sable glisse du verre pendant qu'elle sort. */
    if (lifting && tu > 0.15 && tu < 1.2 && Math.random() < 0.7) {
      for (let i = 0; i < 2; i++) {
        const q = s.tmp2.set((Math.random() - 0.5) * 1.2, -0.62 + Math.random() * 0.4, 0.05).applyMatrix4(s.cover.matrixWorld);
        this.emit(s, q.x, q.y, q.z, (Math.random() - 0.5) * 0.08 + 0.05, -0.05 - Math.random() * 0.15, (Math.random() - 0.5) * 0.08, 0.9 + Math.random() * 0.7);
      }
    }

    /* Le tas s'affaisse, l'appel s'éteint, l'ombre (légère : c'est du verre) suit la cartouche. */
    const heapT = (loading || gate || pano || (intro && tu < 0.1)) ? 1 : 0;
    if (rm) s.heap.a = heapT; else this.spring(s.heap, 'a', heapT, 2.4, dt);
    const ha = Math.max(0, s.heap.a);
    s.heapMesh.visible = ha > 0.01;
    s.heapMesh.scale.y = Math.max(0.01, ha);
    const lureT = pano ? 1 : 0;
    s.halo += (lureT - s.halo) * (1 - Math.exp(-dt * (pano ? 0.8 : 3)));
    const lift = this.smooth(0.25, 0.9, cv.y);
    s.shadow.position.set(cv.x, 0.075, cv.z);
    s.shadowMat.uniforms.uStrength.value = 0.12 * lift;


    /* Le ciel affiché : on ne bascule vers la photo qu'une fois chargée. Notre soleil suit le sien. */
    const want = this.skyMode();
    if (want === 'peint') { if (!s.cloudTex) s.makeClouds(); s.activeSky = 'peint'; }
    else if (s.activeSky !== want && this.ensureSky(s).ready) s.activeSky = want;
    if (s.shownSky !== s.activeSky) {
      s.shownSky = s.activeSky; s.envAt = -99; s.cubeAt = -99;
      this.applyLight(s, s.activeSky === 'photo' ? 'photo' : 'peint');
    }
    const photo = s.activeSky === 'photo';
    s.uSkyMode.value = photo ? 1 : 0;
    if (photo) { s.uSkyTex.value = s.skyPhoto.tex; s.uSkyRot.value = SKY.view; s.sunAz = (SKY.uSun - SKY.view - 0.5) * Math.PI * 2; }
    else s.sunAz = Math.PI + 0.17;
    const elT = photo ? SKY.el * Math.PI / 180 : ((loading || gate || pano) ? 9 * Math.PI / 180 : s.EL);
    s.el += (elT - s.el) * (rm ? 1 : 1 - Math.exp(-dt * 0.8));
    const sx = Math.cos(s.el) * Math.sin(s.sunAz), sy = Math.sin(s.el), sz = Math.cos(s.el) * Math.cos(s.sunAz);
    /* la lumière vient du même côté que le soleil de la photo, un peu plus haut */
    const lel = photo ? Math.max(s.el, SKY.lightEl * Math.PI / 180) : s.el;
    const lx = Math.cos(lel) * Math.sin(s.sunAz), ly = Math.sin(lel), lz = Math.cos(lel) * Math.cos(s.sunAz);
    s.sun.position.set(T.x + lx * 8, T.y + ly * 8, T.z + lz * 8);
    /* soleil haut : on le modère, sinon le sable blanc brûle */
    s.sun.intensity = 1.4 * Math.min(1, 0.36 / Math.max(0.05, ly));
    s.sun.target.position.copy(T);
    s.sun.target.updateMatrixWorld();
    s.uSun.value.set(sx, sy, sz);
    s.mist += ((loading ? 1 : 0) - s.mist) * (rm ? 1 : 1 - Math.exp(-dt * 1.2));
    s.uMist.value = s.mist;
    if (!rm) {
      s.uTime.value = s.t * (playing ? 1.8 : 1);
      s.uSkyTime.value = s.t;
      s.uCloudRot.value = s.t * 0.00004;
      this.updateDust(s, playing);
    }
    this.updateLure(s, rm);
    this.updateBurst(s, rm ? 0 : dt);

    /* Le ciel en cube suit les nuages ; les reflets du verre et du disque en découlent. */
    if (s.t - s.cubeAt > 1.5) { s.cubeAt = s.t; s.updateSky(); }
    if (s.t - s.envAt > (loading || gate || pano || lifting ? 0.6 : 3)) { s.envAt = s.t; s.updateEnv(); }

    try { s.renderer.render(s.scene, cam); } catch (e) { /* rien */ }
  }

  dispose() {
    const s = this._s;
    if (!s) return;
    this._s = null;
    cancelAnimationFrame(s.raf);
    if (s.ro) s.ro.disconnect(); else if (s.resize) window.removeEventListener('resize', s.resize);
    const cv = s.canvas;
    if (cv && s.onDown) {
      cv.removeEventListener('pointerdown', s.onDown);
      cv.removeEventListener('pointermove', s.onDrag);
      cv.removeEventListener('pointerup', s.onUp);
      cv.removeEventListener('pointercancel', s.onUp);
      cv.style.cursor = '';
    }
    if (s.envRT) s.envRT.dispose();
    if (s.pmrem) s.pmrem.dispose();
    if (s.skyRT) s.skyRT.dispose();
    if (s.cloudTex) s.cloudTex.dispose();
    if (s.skyPhoto && s.skyPhoto.tex) s.skyPhoto.tex.dispose();
    if (s.depthTex) s.depthTex.dispose();
    if (s.envScene) s.envScene.traverse((obj) => { if (obj.geometry) obj.geometry.dispose(); if (obj.material) obj.material.dispose(); });
    s.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      const m = obj.material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => {
        ['map', 'normalMap', 'aoMap', 'emissiveMap'].forEach((k) => { if (x[k]) x[k].dispose(); });
        x.dispose();
      });
    });
    s.renderer.dispose();
  }

  /* ---------- la cartouche et son DVD ---------- */

  /* Normales lissées sur les arrondis du verre (sinon on verrait chaque facette du biseau). */
  smoothNormals(geo, maxAngle) {
    geo.computeVertexNormals();
    const p = geo.attributes.position, fn = geo.attributes.normal, n = p.count, cosT = Math.cos(maxAngle);
    const groups = new Map();
    for (let i = 0; i < n; i++) {
      const key = Math.round(p.getX(i) * 1e4) + ',' + Math.round(p.getY(i) * 1e4) + ',' + Math.round(p.getZ(i) * 1e4);
      let g = groups.get(key);
      if (!g) { g = []; groups.set(key, g); }
      g.push(i);
    }
    const out = new Float32Array(n * 3);
    groups.forEach((g) => g.forEach((i) => {
      const ax = fn.getX(i), ay = fn.getY(i), az = fn.getZ(i);
      let x = 0, y = 0, z = 0;
      g.forEach((j) => { const bx = fn.getX(j), by = fn.getY(j), bz = fn.getZ(j); if (ax * bx + ay * by + az * bz >= cosT) { x += bx; y += by; z += bz; } });
      const l = Math.hypot(x, y, z) || 1;
      out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l;
    }));
    geo.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  }

  /* Le collier, dessiné au trait autour du moyeu : la chaîne, les perles bleues, les plaquettes et le pendentif. */
  drawNecklaceArt(ctx, cx, cy, R, u) {
    const rn = R * 0.665, a0 = Math.PI * 0.6, a1 = Math.PI * 1.4;
    const at = (a, fn) => { ctx.save(); ctx.translate(cx + Math.cos(a) * rn, cy + Math.sin(a) * rn); ctx.rotate(a + Math.PI / 2); fn(); ctx.restore(); };
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = '#717b80'; ctx.lineWidth = 2.4 * u;
    let k = 0;
    const link = (a) => at(a, () => { ctx.beginPath(); ctx.ellipse(0, 0, R * 0.019, (k++ % 2) ? R * 0.004 : R * 0.009, 0, 0, Math.PI * 2); ctx.stroke(); });
    for (let a = Math.PI * 0.4; a < a0 - 0.02; a += 0.046) link(a);
    for (let a = a1 + 0.04; a < Math.PI * 1.6; a += 0.046) link(a);
    const nB = 26;
    for (let i = 0; i <= nB; i++) {
      const a = a0 + (a1 - a0) * i / nB;
      if (i % 2 === 1 && Math.abs(a - Math.PI) > 0.1) at(a, () => {
        ctx.beginPath(); ctx.moveTo(-R * 0.011, R * 0.02); ctx.lineTo(R * 0.011, R * 0.02); ctx.lineTo(R * 0.015, R * 0.074); ctx.lineTo(-R * 0.015, R * 0.074); ctx.closePath(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-R * 0.007, R * 0.04); ctx.lineTo(R * 0.007, R * 0.04); ctx.moveTo(-R * 0.008, R * 0.056); ctx.lineTo(R * 0.008, R * 0.056); ctx.stroke();
      });
    }
    /* le pendentif, au milieu : un croissant et une longue plaque gravée */
    at(Math.PI, () => {
      ctx.beginPath(); ctx.arc(0, R * 0.045, R * 0.032, 0, Math.PI); ctx.arc(0, R * 0.045, R * 0.019, Math.PI, 0, true); ctx.closePath(); ctx.stroke();
      ctx.strokeRect(-R * 0.024, R * 0.085, R * 0.048, R * 0.15);
      ctx.strokeRect(-R * 0.014, R * 0.097, R * 0.028, R * 0.126);
      [0.122, 0.16, 0.198].forEach((yy) => { ctx.beginPath(); ctx.arc(0, R * yy, R * 0.0075, 0, Math.PI * 2); ctx.stroke(); });
    });
    for (let i = 0; i <= nB; i++) {
      const a = a0 + (a1 - a0) * i / nB;
      at(a, () => {
        ctx.beginPath(); ctx.arc(0, 0, R * 0.016, 0, Math.PI * 2);
        ctx.fillStyle = '#3f98bf'; ctx.fill(); ctx.lineWidth = 1.6 * u; ctx.strokeStyle = '#4f7383'; ctx.stroke();
        ctx.beginPath(); ctx.arc(-R * 0.005, -R * 0.005, R * 0.004, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
        ctx.lineWidth = 2.4 * u; ctx.strokeStyle = '#717b80';
      });
    }
  }
  /* La face imprimée du DVD, très épurée : blanc nacré, moyeu clair, le collier et ses perles à gauche, le logo à droite. */
  drawDisc(ctx, N, logo) {
    const u = N / 2048, c = N / 2, R = N / 2;
    const circ = (r) => { ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); };
    ctx.clearRect(0, 0, N, N);
    circ(R); ctx.fillStyle = '#f5f4f0'; ctx.fill();
    const g = ctx.createRadialGradient(c * 0.75, c * 0.65, R * 0.1, c, c, R);
    g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(214,220,224,0.35)');
    circ(R); ctx.fillStyle = g; ctx.fill();
    /* le moyeu : plastique clair et ses anneaux */
    circ(R * 0.38); ctx.fillStyle = '#e2e6e8'; ctx.fill();
    circ(R * 0.2); ctx.fillStyle = '#eef0f1'; ctx.fill();
    ctx.lineWidth = 1.6 * u; ctx.strokeStyle = 'rgba(132,142,148,0.55)';
    [0.38, 0.29, 0.2, 0.135].forEach((k) => { circ(R * k); ctx.stroke(); });
    circ(R * 0.997); ctx.lineWidth = 3 * u; ctx.strokeStyle = 'rgba(110,118,124,0.45)'; ctx.stroke();
    this.drawNecklaceArt(ctx, c, c, R, u);
    /* le logo, seul */
    if (logo && logo.width) {
      const w = R * 0.54, h = w * logo.height / logo.width;
      ctx.drawImage(logo, c + R * 0.64 - w / 2, c - R * 0.03 - h / 2, w, h);
    }
  }
}
