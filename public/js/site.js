/* UMDC — site public.
   Lit /api/site (ou data/site.json en repli statique), construit la navigation,
   la tracklist et les panneaux, et gère le lecteur audio de l'onglet Écouter. */

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const els = {
    menu: $('menu'),
    tracks: $('tracks'),
    playerTracks: $('player-tracks'),
    socials: $('socials'),
    platforms: $('platforms'),
    contactLinks: $('contact-links'),
    newsletterBody: $('newsletter-body'),
    contactBody: $('contact-body'),
    listenBody: $('listen-body'),
    signup: $('signup'),
    signupEmail: $('signup-email'),
    signupSubmit: $('signup-submit'),
    signupMsg: $('signup-msg'),
    dock: $('dock'),
    dockToggle: $('dock-toggle'),
    dockClose: $('dock-close'),
    dockTitle: $('dock-title'),
    dockTime: $('dock-time'),
    dockLinks: $('dock-links'),
    dockSeek: $('dock-seek'),
    audio: $('audio'),
  };

  let site = null;
  let openView = null;          // id du panneau ouvert, null = tracklist
  let currentTrackId = null;

  /* --------------------------------------------------------- chargement */

  // Avec le serveur : /api/site. Déposé tel quel sur un hébergeur statique,
  // on retombe sur site.json — le fichier produit par `node server.js export`,
  // déjà filtré côté serveur.
  async function loadSite() {
    try {
      const res = await fetch('api/site', { headers: { Accept: 'application/json' } });
      if (res.ok) return await res.json();
    } catch (err) {
      /* pas de serveur : on tente l'export statique */
    }
    const res = await fetch('site.json');
    if (!res.ok) throw new Error('Configuration introuvable.');
    return res.json();
  }

  /* ------------------------------------------------------------- rendu */

  function renderMenu() {
    els.menu.replaceChildren();

    site.nav.forEach((item) => {
      // L'onglet Écouter n'apparaît que le jour de la sortie.
      if (item.id === 'ecouter' && !site.release.released) return;

      const button = document.createElement('button');
      button.className = 'menu__item';
      button.type = 'button';
      button.dataset.view = item.id;
      button.textContent = '>' + (item.label || item.id).toUpperCase();
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-controls', 'view-' + item.id);
      button.addEventListener('click', () => toggleView(item.id));
      els.menu.append(button);

      const title = $(item.id + '-title');
      if (title) title.textContent = '>' + (item.label || item.id).toUpperCase();
    });
  }

  function trackLine(track) {
    const frag = document.createDocumentFragment();

    const n = document.createElement('span');
    n.className = 'track__n';
    n.textContent = track.n + '.';
    frag.append(n, track.title);

    if (track.feat) {
      const feat = document.createElement('span');
      feat.className = 'track__feat';
      feat.textContent = track.feat;
      frag.append(feat);
    }
    return frag;
  }

  function renderTracks() {
    els.tracks.replaceChildren();
    site.tracks.forEach((track) => {
      const li = document.createElement('li');
      li.className = 'track';
      li.append(trackLine(track));
      els.tracks.append(li);
    });
  }

  function renderPlayerTracks() {
    els.playerTracks.replaceChildren();

    site.tracks.forEach((track) => {
      const li = document.createElement('li');
      li.className = 'track';
      li.dataset.trackId = track.id;

      const button = document.createElement('button');
      button.className = 'track__play';
      button.type = 'button';
      button.append(trackLine(track));

      if (track.playable) {
        button.addEventListener('click', () => play(track));
      } else {
        button.disabled = true;
        button.title = 'Extrait pas encore en ligne';
      }

      li.append(button);
      els.playerTracks.append(li);
    });
  }

  function renderLinkList(target, items, { prefix = '>' } = {}) {
    target.replaceChildren();

    items.forEach((item) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = item.url;
      a.textContent = prefix + (item.name || '').toUpperCase();
      if (/^https?:/i.test(item.url)) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
      if (item.handle) {
        const handle = document.createElement('span');
        handle.className = 'handle';
        handle.textContent = item.handle;
        a.append(handle);
      }
      li.append(a);
      target.append(li);
    });
  }

  function renderPanels() {
    renderLinkList(els.socials, site.socials);
    renderLinkList(els.platforms, site.platforms);

    els.newsletterBody.textContent = site.newsletter.body || '';
    els.signupSubmit.textContent = (site.newsletter.cta || 'REJOINDRE').toUpperCase();

    els.contactBody.textContent = site.contact.body || '';
    renderLinkList(
      els.contactLinks,
      site.contact.email ? [{ name: site.contact.email, url: 'mailto:' + site.contact.email }] : [],
    );

    els.listenBody.textContent = site.release.released
      ? site.release.listenHeadline || ''
      : '';

    if (site.release.albumTitle) {
      document.title = `${site.release.albumTitle} — UMDC`;
    }

    renderTracks();
    renderPlayerTracks();
  }

  /* ---------------------------------------------------------- panneaux */

  function toggleView(id) {
    setView(openView === id ? null : id);
  }

  function setView(id) {
    openView = id;

    document.querySelectorAll('.view').forEach((view) => {
      view.hidden = view.id !== (id ? 'view-' + id : 'view-tracks');
    });

    els.menu.querySelectorAll('.menu__item').forEach((button) => {
      button.setAttribute('aria-expanded', String(button.dataset.view === id));
    });

    const hash = id ? '#' + id : '';
    if (location.hash !== hash) history.replaceState(null, '', location.pathname + hash);

    // Les panneaux sont courts : on remonte, sinon ils restent cachés derrière
    // le lettrage quand on avait descendu dans la tracklist.
    if (id) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      $('view-' + id)?.querySelector('button, a, input')?.focus({ preventScroll: true });
    }
  }

  /* ---------------------------------------------------------- lecteur */

  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  function play(track) {
    if (currentTrackId === track.id && !els.audio.paused) {
      els.audio.pause();
      return;
    }

    if (currentTrackId !== track.id) {
      els.audio.src = track.audio;
      currentTrackId = track.id;
      els.dockTitle.textContent = track.n + '. ' + track.title;
      renderDockLinks(track);
    }

    els.dock.hidden = false;
    els.audio.play().catch(() => {
      els.dockTitle.textContent = 'Lecture impossible';
    });
  }

  // Liens d'écoute propres au titre en cours, s'il y en a.
  function renderDockLinks(track) {
    els.dockLinks.replaceChildren();

    site.platforms.forEach((platform) => {
      const url = track.links[platform.id];
      if (!url) return;
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = (platform.name || platform.id).toUpperCase();
      els.dockLinks.append(a);
    });
  }

  function markPlaying() {
    els.playerTracks.querySelectorAll('.track').forEach((li) => {
      li.classList.toggle(
        'is-playing',
        li.dataset.trackId === currentTrackId && !els.audio.paused,
      );
    });
    els.dockToggle.textContent = els.audio.paused ? '▶' : '❚❚';
  }

  function wirePlayer() {
    els.dockToggle.addEventListener('click', () => {
      if (els.audio.paused) els.audio.play().catch(() => {});
      else els.audio.pause();
    });

    els.dockClose.addEventListener('click', () => {
      els.audio.pause();
      els.audio.removeAttribute('src');
      els.audio.load();
      currentTrackId = null;
      els.dockLinks.replaceChildren();
      els.dock.hidden = true;
      markPlaying();
    });

    els.audio.addEventListener('play', markPlaying);
    els.audio.addEventListener('pause', markPlaying);
    els.audio.addEventListener('ended', markPlaying);

    els.audio.addEventListener('timeupdate', () => {
      const { currentTime, duration } = els.audio;
      els.dockTime.textContent = Number.isFinite(duration)
        ? `${formatTime(currentTime)} / ${formatTime(duration)}`
        : formatTime(currentTime);
      if (Number.isFinite(duration) && duration > 0) {
        els.dockSeek.value = String(Math.round((currentTime / duration) * 1000));
      }
    });

    els.dockSeek.addEventListener('input', () => {
      const { duration } = els.audio;
      if (Number.isFinite(duration) && duration > 0) {
        els.audio.currentTime = (Number(els.dockSeek.value) / 1000) * duration;
      }
    });
  }

  /* ------------------------------------------------------- newsletter */

  function wireSignup() {
    els.signup.addEventListener('submit', async (event) => {
      event.preventDefault();

      const email = els.signupEmail.value.trim();
      els.signupMsg.classList.remove('is-error');

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        els.signupMsg.textContent = 'Email invalide.';
        els.signupMsg.classList.add('is-error');
        els.signupEmail.focus();
        return;
      }

      els.signupSubmit.disabled = true;
      els.signupMsg.textContent = '…';

      try {
        const res = await fetch('api/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Envoi impossible.');

        els.signupMsg.textContent = site.newsletter.success || 'C’EST BON. À BIENTÔT.';
        els.signup.reset();
      } catch (err) {
        // Sans serveur (hébergement statique), on bascule sur un mailto.
        const to = site.contact.email;
        if (to) {
          els.signupMsg.textContent = 'Ouverture de ton logiciel mail…';
          location.href =
            `mailto:${to}?subject=${encodeURIComponent('Newsletter UMDC')}` +
            `&body=${encodeURIComponent('Inscris cet email : ' + email)}`;
        } else {
          els.signupMsg.textContent = err.message;
          els.signupMsg.classList.add('is-error');
        }
      } finally {
        els.signupSubmit.disabled = false;
      }
    });
  }

  /* ------------------------------------------------------------- init */

  function wireGlobal() {
    document.querySelectorAll('[data-close]').forEach((button) => {
      button.addEventListener('click', () => setView(null));
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && openView) setView(null);
    });
  }

  // Si la sortie tombe pendant que la page est ouverte, l'onglet Écouter
  // apparaît tout seul — pas besoin de recharger.
  function watchRelease() {
    const date = Date.parse(site.release.date || '');
    if (!Number.isFinite(date) || site.release.released) return;

    const wait = date - Date.now();
    if (wait <= 0 || wait > 2 ** 31 - 1) return;
    setTimeout(() => location.reload(), wait + 1000);
  }

  (async () => {
    try {
      site = await loadSite();
    } catch (err) {
      els.tracks.textContent = 'Contenu indisponible.';
      return;
    }

    renderMenu();
    renderPanels();
    wireGlobal();
    wireSignup();
    wirePlayer();
    watchRelease();

    const fromHash = location.hash.slice(1);
    if (fromHash && $('view-' + fromHash) && els.menu.querySelector(`[data-view="${fromHash}"]`)) {
      setView(fromHash);
    }
  })();
})();
