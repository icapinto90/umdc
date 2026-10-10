/* UMDC — back-office.
   Édite data/site.json via l'API, gère la bibliothèque audio et les inscrits. */

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const KEY_STORAGE = 'umdc.admin.key';

  let key = sessionStorage.getItem(KEY_STORAGE) || '';
  let site = null;
  let audioFiles = [];
  let dirty = false;

  /* --------------------------------------------------------------- api */

  async function api(path, { method = 'GET', body, raw, headers = {} } = {}) {
    const res = await fetch(path, {
      method,
      headers: {
        'x-umdc-key': key,
        ...(raw ? {} : body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: raw || (body ? JSON.stringify(body) : undefined),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    return data;
  }

  function uid() {
    return 'x' + Math.random().toString(36).slice(2, 9);
  }

  function setStatus(text, { sticky = false } = {}) {
    $('save-status').textContent = text;
    if (!sticky && text) setTimeout(() => { if ($('save-status').textContent === text) $('save-status').textContent = ''; }, 3000);
  }

  function markDirty() {
    dirty = true;
    setStatus('Modifications non enregistrées', { sticky: true });
  }

  /* ------------------------------------------------------------- accès */

  $('gate-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    key = $('gate-password').value;
    try {
      await api('api/admin/login', { method: 'POST' });
      sessionStorage.setItem(KEY_STORAGE, key);
      $('gate-password').value = '';
      await start();
    } catch (err) {
      $('gate-msg').textContent = 'Mot de passe incorrect.';
      key = '';
    }
  });

  async function start() {
    const data = await api('api/admin/site');
    site = normalise(data.site);
    $('gate').hidden = true;
    $('app').hidden = false;
    renderAll(data.released);
    await Promise.all([loadAudio(), loadSubscribers()]);
  }

  // Comble les champs absents pour que l'UI n'ait jamais à tester l'existence.
  function normalise(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    s.brand ||= { name: 'UMDC', subtitle: 'UN MONDE DE CHALANCE®' };
    s.release ||= {};
    s.release.mode ||= 'auto';
    s.newsletter ||= {};
    s.contact ||= {};
    s.nav = Array.isArray(s.nav) && s.nav.length ? s.nav : [
      { id: 'reseaux', label: 'RÉSEAUX', visible: true },
      { id: 'rejoindre', label: 'REJOINDRE', visible: true },
      { id: 'email', label: 'EMAIL', visible: true },
      { id: 'ecouter', label: 'ÉCOUTER', visible: true },
    ];
    s.socials = Array.isArray(s.socials) ? s.socials : [];
    s.platforms = Array.isArray(s.platforms) ? s.platforms : [];
    s.tracks = Array.isArray(s.tracks) ? s.tracks : [];
    s.tracks.forEach((track) => {
      track.id ||= uid();
      track.links ||= {};
      if (track.released === undefined) track.released = true;
    });
    return s;
  }

  /* ------------------------------------------------------------ onglets */

  $('tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
    document.querySelectorAll('.tabpane').forEach((p) => {
      p.classList.toggle('is-active', p.dataset.pane === tab.dataset.tab);
    });
  });

  /* ------------------------------------------------------------- rendu */

  function renderAll(released) {
    renderRelease(released);
    renderList('platforms', site.platforms, { nameLabel: 'Nom', urlLabel: 'Lien' });
    renderList('socials', site.socials, { nameLabel: 'Nom', urlLabel: 'Lien', handle: true });
    renderNav();
    renderTexts();
    renderTracks();
  }

  function renderRelease(released) {
    const pill = $('release-pill');
    pill.textContent = released ? 'Écoute ouverte' : 'Écoute fermée';
    pill.classList.toggle('is-live', Boolean(released));

    const mode = site.release.mode || 'auto';
    $('release-mode').querySelectorAll('input').forEach((input) => {
      input.checked = input.value === mode;
      input.onchange = () => {
        site.release.mode = input.value;
        markDirty();
        refreshPill();
      };
    });

    $('release-date').value = toLocalInput(site.release.date);
    $('release-date').oninput = (event) => {
      const value = event.target.value;
      site.release.date = value ? new Date(value).toISOString() : '';
      markDirty();
      refreshPill();
    };

    bindText('album-title', () => site.release.albumTitle, (v) => (site.release.albumTitle = v));
    bindText('listen-headline', () => site.release.listenHeadline, (v) => (site.release.listenHeadline = v));
  }

  // Aperçu immédiat de l'état sans attendre l'enregistrement.
  function refreshPill() {
    const mode = site.release.mode;
    const date = Date.parse(site.release.date || '');
    const live = mode === 'on' || (mode === 'auto' && Number.isFinite(date) && Date.now() >= date);
    const pill = $('release-pill');
    pill.textContent = live ? 'Écoute ouverte' : 'Écoute fermée';
    pill.classList.toggle('is-live', live);
  }

  function toLocalInput(iso) {
    const date = new Date(iso || '');
    if (Number.isNaN(date.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
           `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function bindText(id, get, set) {
    const el = $(id);
    el.value = get() || '';
    el.oninput = () => { set(el.value); markDirty(); };
  }

  function renderTexts() {
    bindText('nl-body', () => site.newsletter.body, (v) => (site.newsletter.body = v));
    bindText('nl-cta', () => site.newsletter.cta, (v) => (site.newsletter.cta = v));
    bindText('nl-success', () => site.newsletter.success, (v) => (site.newsletter.success = v));
    bindText('contact-body', () => site.contact.body, (v) => (site.contact.body = v));
    bindText('contact-email', () => site.contact.email, (v) => (site.contact.email = v));
  }

  function moveButtons(list, index, rerender) {
    const grip = document.createElement('div');
    grip.className = 'row__grip';

    [['▲', -1], ['▼', 1]].forEach(([glyph, delta]) => {
      const button = document.createElement('button');
      button.className = 'row__move';
      button.type = 'button';
      button.textContent = glyph;
      button.title = delta < 0 ? 'Monter' : 'Descendre';
      button.disabled = index + delta < 0 || index + delta >= list.length;
      button.onclick = () => {
        const [item] = list.splice(index, 1);
        list.splice(index + delta, 0, item);
        markDirty();
        rerender();
      };
      grip.append(button);
    });

    return grip;
  }

  function input(value, placeholder, onInput, type = 'text') {
    const el = document.createElement('input');
    el.type = type;
    el.value = value || '';
    el.placeholder = placeholder;
    el.oninput = () => { onInput(el.value); markDirty(); };
    return el;
  }

  function deleteButton(list, index, rerender, label) {
    const button = document.createElement('button');
    button.className = 'btn btn--danger btn--icon';
    button.type = 'button';
    button.textContent = '✕';
    button.title = 'Supprimer';
    button.onclick = () => {
      if (!confirm(`Supprimer ${label} ?`)) return;
      list.splice(index, 1);
      markDirty();
      rerender();
    };
    return button;
  }

  function renderList(target, list, opts) {
    const host = $(target);
    const rerender = () => renderList(target, list, opts);
    host.replaceChildren();

    list.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.append(moveButtons(list, index, rerender));
      row.append(input(item.name, opts.nameLabel, (v) => (item.name = v)));
      row.append(input(item.url, opts.urlLabel + ' (https://…)', (v) => (item.url = v), 'url'));
      if (opts.handle) row.append(input(item.handle, '@pseudo', (v) => (item.handle = v)));
      row.append(deleteButton(list, index, rerender, `« ${item.name || 'cette entrée'} »`));
      host.append(row);
    });

    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'card__hint';
      empty.textContent = 'Rien pour l’instant.';
      host.append(empty);
    }
  }

  function renderNav() {
    const host = $('nav');
    host.replaceChildren();

    site.nav.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'row row--nav';
      row.append(moveButtons(site.nav, index, renderNav));
      row.append(input(item.label, 'Libellé', (v) => (item.label = v)));

      const toggle = document.createElement('label');
      toggle.className = 'toggle';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = item.visible !== false;
      checkbox.onchange = () => { item.visible = checkbox.checked; markDirty(); };
      toggle.append(checkbox, document.createTextNode('visible'));
      row.append(toggle);

      host.append(row);
    });
  }

  /* --------------------------------------------------------- tracklist */

  function renderTracks() {
    const host = $('tracks');
    host.replaceChildren();

    site.tracks.forEach((track, index) => {
      const row = document.createElement('div');
      row.className = 'trackrow';

      /* ---- ligne repliée ---- */
      const head = document.createElement('div');
      head.className = 'trackrow__head';
      head.append(moveButtons(site.tracks, index, renderTracks));

      const n = document.createElement('span');
      n.className = 'trackrow__n';
      n.textContent = index + 1 + '.';
      head.append(n);

      head.append(input(track.title, 'Titre', (v) => (track.title = v)));

      const feat = input(track.feat, 'FT. …', (v) => (track.feat = v));
      feat.className = 'trackrow__feat';
      head.append(feat);

      const toggle = document.createElement('label');
      toggle.className = 'toggle';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = track.released !== false;
      checkbox.onchange = () => { track.released = checkbox.checked; markDirty(); };
      toggle.append(checkbox, document.createTextNode('en ligne'));
      head.append(toggle);

      const expand = document.createElement('button');
      expand.className = 'btn btn--icon';
      expand.type = 'button';
      expand.textContent = track.audio ? '♪ ▾' : '▾';
      expand.title = 'Son et liens';
      expand.onclick = () => row.classList.toggle('is-open');
      head.append(expand);

      row.append(head);

      /* ---- détails ---- */
      const body = document.createElement('div');
      body.className = 'trackrow__body';

      const audioBlock = document.createElement('div');
      audioBlock.className = 'trackrow__audio';

      const label = document.createElement('span');
      label.className = 'field__label';
      label.textContent = 'Son :';
      audioBlock.append(label);

      const select = document.createElement('select');
      const none = new Option('— aucun —', '');
      select.append(none);
      audioFiles.forEach((file) => select.append(new Option(file.name, file.url)));
      if (track.audio && !audioFiles.some((f) => f.url === track.audio)) {
        select.append(new Option(track.audio + ' (introuvable)', track.audio));
      }
      select.value = track.audio || '';
      select.onchange = () => {
        track.audio = select.value;
        markDirty();
        renderTracks();
        document.querySelectorAll('.trackrow')[index]?.classList.add('is-open');
      };
      audioBlock.append(select);

      if (track.audio) {
        const player = document.createElement('audio');
        player.controls = true;
        player.preload = 'none';
        player.src = track.audio;
        audioBlock.append(player);
      }

      body.append(audioBlock);

      const links = document.createElement('div');
      links.className = 'trackrow__links';
      site.platforms.forEach((platform) => {
        const field = document.createElement('label');
        field.className = 'field';
        const name = document.createElement('span');
        name.className = 'field__label';
        name.textContent = platform.name || platform.id;
        const url = input(
          track.links[platform.id] || '',
          'Lien direct vers le titre',
          (v) => {
            if (v) track.links[platform.id] = v;
            else delete track.links[platform.id];
          },
          'url',
        );
        url.className = 'field__input';
        field.append(name, url);
        links.append(field);
      });
      if (site.platforms.length) body.append(links);

      const remove = document.createElement('div');
      remove.className = 'btnrow';
      remove.style.margin = '0';
      remove.append(deleteButton(site.tracks, index, renderTracks, `la piste « ${track.title || index + 1} »`));
      body.append(remove);

      row.append(body);
      host.append(row);
    });
  }

  /* ------------------------------------------------------------ ajouts */

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-add]');
    if (!button) return;

    if (button.dataset.add === 'platform') {
      site.platforms.push({ id: uid(), name: '', url: '' });
      renderList('platforms', site.platforms, { nameLabel: 'Nom', urlLabel: 'Lien' });
    }
    if (button.dataset.add === 'social') {
      site.socials.push({ id: uid(), name: '', url: '', handle: '' });
      renderList('socials', site.socials, { nameLabel: 'Nom', urlLabel: 'Lien', handle: true });
    }
    if (button.dataset.add === 'track') {
      site.tracks.push({ id: uid(), title: '', feat: '', audio: '', links: {}, released: true });
      renderTracks();
    }
    markDirty();
  });

  /* ---------------------------------------------------- enregistrement */

  $('save').addEventListener('click', async () => {
    $('save').disabled = true;
    setStatus('Enregistrement…', { sticky: true });
    try {
      const data = await api('api/admin/site', { method: 'PUT', body: site });
      dirty = false;
      setStatus('Enregistré ✓');
      renderRelease(data.released);
    } catch (err) {
      setStatus(err.message, { sticky: true });
    } finally {
      $('save').disabled = false;
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (dirty) event.preventDefault();
  });

  /* -------------------------------------------------------------- audio */

  async function loadAudio() {
    try {
      audioFiles = (await api('api/admin/audio')).files || [];
    } catch (err) {
      audioFiles = [];
    }
    renderAudio();
    renderTracks();
  }

  function renderAudio() {
    const host = $('filelist');
    host.replaceChildren();

    if (!audioFiles.length) {
      const empty = document.createElement('p');
      empty.className = 'card__hint';
      empty.textContent = 'Aucun fichier pour l’instant.';
      host.append(empty);
      return;
    }

    audioFiles.forEach((file) => {
      const li = document.createElement('li');

      const name = document.createElement('span');
      name.className = 'filelist__name';
      name.textContent = file.name;

      const size = document.createElement('span');
      size.className = 'filelist__size';
      size.textContent = (file.size / 1024 / 1024).toFixed(1) + ' Mo';

      const player = document.createElement('audio');
      player.controls = true;
      player.preload = 'none';
      player.src = file.url;

      const used = site.tracks.filter((track) => track.audio === file.url);
      const remove = document.createElement('button');
      remove.className = 'btn btn--danger btn--icon';
      remove.type = 'button';
      remove.textContent = '✕';
      remove.title = 'Supprimer le fichier';
      remove.onclick = async () => {
        const warning = used.length
          ? `« ${file.name} » est utilisé par ${used.length} piste(s). Supprimer quand même ?`
          : `Supprimer « ${file.name} » ?`;
        if (!confirm(warning)) return;
        await api('api/admin/audio/' + encodeURIComponent(file.name), { method: 'DELETE' });
        used.forEach((track) => { track.audio = ''; });
        if (used.length) markDirty();
        await loadAudio();
      };

      li.append(name, size, player, remove);
      host.append(li);
    });
  }

  async function upload(files) {
    for (const file of files) {
      setStatus(`Envoi de ${file.name}…`, { sticky: true });
      try {
        await api('api/admin/audio', {
          method: 'POST',
          raw: file,
          headers: { 'x-filename': encodeFilename(file.name), 'Content-Type': 'application/octet-stream' },
        });
      } catch (err) {
        setStatus(`${file.name} : ${err.message}`, { sticky: true });
        return;
      }
    }
    setStatus('Fichiers envoyés ✓');
    await loadAudio();
  }

  // Les en-têtes HTTP n'acceptent que l'ASCII : on translittère avant d'envoyer.
  function encodeFilename(name) {
    return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '-');
  }

  $('drop').addEventListener('click', () => $('audio-input').click());
  $('audio-input').addEventListener('change', (event) => {
    upload([...event.target.files]);
    event.target.value = '';
  });

  ['dragenter', 'dragover'].forEach((type) => {
    $('drop').addEventListener(type, (event) => {
      event.preventDefault();
      $('drop').classList.add('is-over');
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    $('drop').addEventListener(type, (event) => {
      event.preventDefault();
      $('drop').classList.remove('is-over');
      if (type === 'drop') upload([...event.dataTransfer.files].filter((f) => f.type.startsWith('audio/')));
    });
  });

  /* --------------------------------------------------------- inscrits */

  let subscribers = [];

  async function loadSubscribers() {
    try {
      subscribers = (await api('api/admin/subscribers')).subscribers || [];
    } catch (err) {
      subscribers = [];
    }
    $('subs-count').textContent = subscribers.length;

    const host = $('subs');
    host.replaceChildren();

    if (!subscribers.length) {
      const empty = document.createElement('p');
      empty.className = 'card__hint';
      empty.textContent = 'Personne pour l’instant.';
      host.append(empty);
      return;
    }

    [...subscribers].reverse().forEach((entry) => {
      const li = document.createElement('li');
      const email = document.createElement('span');
      email.className = 'subs__email';
      email.textContent = entry.email;
      const date = document.createElement('span');
      date.className = 'subs__date';
      date.textContent = new Date(entry.date).toLocaleDateString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      });
      li.append(email, date);
      host.append(li);
    });
  }

  $('subs-refresh').addEventListener('click', loadSubscribers);

  $('subs-csv').addEventListener('click', () => {
    const rows = [['email', 'date'], ...subscribers.map((s) => [s.email, s.date])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), 'umdc-newsletter.csv');
  });

  $('subs-clear').addEventListener('click', async () => {
    if (!confirm('Effacer définitivement tous les emails collectés ?')) return;
    await api('api/admin/subscribers', { method: 'DELETE' });
    await loadSubscribers();
  });

  /* -------------------------------------------------------- import/export */

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  $('export-json').addEventListener('click', () => {
    download(new Blob([JSON.stringify(site, null, 2)], { type: 'application/json' }), 'umdc-site.json');
  });

  $('import-json').addEventListener('click', () => $('import-file').click());

  $('import-file').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (!confirm('Remplacer toute la configuration actuelle par ce fichier ?')) return;
    try {
      site = normalise(JSON.parse(await file.text()));
      renderAll();
      refreshPill();
      markDirty();
      setStatus('Importé — pense à enregistrer', { sticky: true });
    } catch (err) {
      setStatus('Fichier JSON illisible.', { sticky: true });
    }
  });

  /* -------------------------------------------------------------- boot */

  if (key) {
    start().catch(() => {
      sessionStorage.removeItem(KEY_STORAGE);
      key = '';
    });
  }
})();
