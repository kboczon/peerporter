'use strict';

/*
 * PeerPorter - content script.
 * Puts a small button on every YouTube thumbnail. YouTube is a single page app
 * that creates and re-uses cards while you scroll, so the injection runs again
 * on a debounced MutationObserver plus YouTube's own navigation events.
 */

(() => {
  const BTN_CLASS = 'ptp-btn';
  const HANDLED = 'ptpHandled';

  // Current YouTube (2026) uses the lockup view model; the older ids are kept as
  // fallbacks so the extension keeps working on cards YouTube has not migrated.
  const CANDIDATES = [
    'a.ytLockupViewModelContentImage',
    'a.ytLockupViewModelContentImageWrapper',
    'a.yt-thumbnail-view-model__anchor',
    'a#thumbnail',
    'a[href*="/watch?v="]',
    'a[href*="/shorts/"]'
  ];

  const CARDS = [
    'ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-compact-video-renderer',
    'ytd-grid-video-renderer', 'ytd-playlist-video-renderer', 'ytd-reel-item-renderer',
    'ytd-media-lockup-view-model', 'yt-lockup-view-model', 'ytd-thumb-alist-video-renderer',
    'yt-image-card-view-model'
  ].join(', ');

  const MIN_THUMB_WIDTH = 90;

  const imported = new Set();
  let ready = false;

  // ---------- helpers ----------

  function videoId(href) {
    if (!href) return null;
    try {
      const url = new URL(href, location.origin);
      const v = url.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = url.pathname.match(/^\/(?:shorts|live|embed|v)\/([\w-]{11})/);
      if (m) return m[1];
      if (url.hostname === 'youtu.be') {
        const id = url.pathname.split('/')[1];
        if (id && /^[\w-]{11}$/.test(id)) return id;
      }
    } catch (e) { /* not a usable url */ }
    return null;
  }

  function cardOf(anchor) {
    return anchor.closest(CARDS) || anchor.parentElement || anchor;
  }

  function titleOf(card, anchor) {
    const selectors = [
      '#video-title[title]', '#video-title',
      '.yt-content-metadata-view-model__metadata-text',
      '.yt-lockup-metadata-view-model-wm__compat__metadata-title',
      '.yt-lockup-metadata-view-model__title',
      'yt-formatted-string[title]', 'h3[title]', 'h4[title]', 'h3', 'h4'
    ];
    for (const sel of selectors) {
      const el = card.querySelector(sel);
      if (!el) continue;
      const text = (el.getAttribute('title') || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length > 2 && text.length < 200) return text;
    }
    const label = anchor.getAttribute('aria-label');
    if (label && label.length > 2) return label.replace(/\s+/g, ' ').trim();
    const img = anchor.querySelector('img');
    if (img && img.alt && img.alt.length > 2) return img.alt.replace(/\s+/g, ' ').trim();
    return '';
  }

  function setState(btn, state, message) {
    btn.dataset.state = state;
    btn.textContent = { idle: 'PT', wait: '\u2026', done: '\u2713', duplicate: '\u2713', error: '!' }[state] || 'PT';
    const channel = btn.dataset.channel ? ' into ' + btn.dataset.channel : ' into PeerTube';
    if (state === 'error') btn.title = 'PeerTube import failed: ' + (message || 'unknown error');
    else if (state === 'done') btn.title = 'Queued for import' + channel + (message ? ' - ' + message : '');
    else if (state === 'duplicate') btn.title = 'Already queued' + channel + (message ? ' (' + message + ')' : '');
    else if (state === 'wait') btn.title = 'Sending to PeerTube\u2026';
    else btn.title = 'Import this video' + channel;
  }

  async function send(msg) {
    try {
      return await browser.runtime.sendMessage(msg);
    } catch (e) {
      return { ok: false, code: 'extension_context_lost', message: String(e && e.message ? e.message : e) };
    }
  }

  // ---------- click ----------

  async function handleImport(btn, url, title) {
    setState(btn, 'wait');
    const reply = await send({ type: 'pt:import', url, title });
    if (reply && reply.ok) {
      if (reply.videoUrl) btn.dataset.videoUrl = reply.videoUrl;
      setState(btn, reply.duplicate ? 'duplicate' : 'done', reply.message);
      imported.add(btn.dataset.videoId);
      return;
    }
    setState(btn, 'error', reply && reply.message);
    // Let the user retry with a click after a fix (for example after connecting).
    setTimeout(() => { if (btn.isConnected) setState(btn, 'idle'); }, 6000);
  }

  function makeButton(anchor, id, title) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.dataset.videoId = id;
    btn.setAttribute('aria-label', 'Import this video into PeerTube');
    setState(btn, imported.has(id) ? 'duplicate' : 'idle');
    if (imported.has(id)) btn.dataset.videoUrl = '';

    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (btn.dataset.state === 'wait') return;
      if (btn.dataset.state === 'done' && btn.dataset.videoUrl) {
        window.open(btn.dataset.videoUrl, '_blank', 'noopener');
        return;
      }
      handleImport(btn, 'https://www.youtube.com/watch?v=' + id, title);
    }, true);

    // Do not let the card treat the press as a click on the thumbnail link.
    for (const evt of ['mousedown', 'pointerdown', 'mouseup', 'touchstart']) {
      btn.addEventListener(evt, (ev) => { ev.stopPropagation(); ev.preventDefault(); }, true);
    }
    btn.addEventListener('mouseenter', (ev) => ev.stopPropagation());
    return btn;
  }

  function inject(anchor, id, title) {
    const style = getComputedStyle(anchor);
    if (style.position === 'static') anchor.style.position = 'relative';
    const btn = makeButton(anchor, id, title);
    anchor.appendChild(btn);
  }

  // ---------- scanning ----------

  function candidates() {
    const seen = new Set();
    const out = [];
    for (const sel of CANDIDATES) {
      let nodes;
      try { nodes = document.querySelectorAll(sel); } catch (e) { continue; }
      for (const node of nodes) {
        if (seen.has(node)) continue;
        seen.add(node);
        out.push(node);
      }
    }
    return out;
  }

  function scan() {
    if (location.hostname.startsWith('music.')) return;   // not for YouTube Music
    for (const anchor of candidates()) {
      const id = videoId(anchor.getAttribute('href'));
      if (!id) continue;
      if (!anchor.querySelector('img')) continue;         // text links, not thumbnails
      if (anchor.classList.contains(BTN_CLASS)) continue;
      if (anchor.closest('.' + BTN_CLASS)) continue;

      const card = cardOf(anchor);
      if (card.querySelector(':scope > .' + BTN_CLASS) || card.querySelector('.' + BTN_CLASS)) {
        if (!anchor[HANDLED]) anchor[HANDLED] = id;       // another anchor of this card has one
        continue;
      }
      if (anchor[HANDLED] === id) continue;

      const rect = anchor.getBoundingClientRect();
      if (rect.width && rect.width < MIN_THUMB_WIDTH) continue;   // retry on a later pass

      inject(anchor, id, titleOf(card, anchor));
      anchor[HANDLED] = id;
    }
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; scan(); }, 250);
  }

  async function initState() {
    const reply = await send({ type: 'pt:state' });
    if (reply && reply.ok !== false) {
      (reply.imported || []).forEach((id) => imported.add(id));
      ready = Boolean(reply.ready);
      scan();
      for (const btn of document.querySelectorAll('.' + BTN_CLASS)) {
        if (imported.has(btn.dataset.videoId)) setState(btn, 'duplicate');
      }
    }
  }

  // ---------- recovery after an extension reload ----------

  // When the add-on is reloaded from about:debugging, Firefox leaves the previous content script
  // running inside this document. Its MutationObserver keeps adding buttons, but every one of
  // them holds a message port to a context that no longer exists, so clicking can only fail -
  // that is the false "!" people blame on PeerTube. That code cannot be switched off from here,
  // so we remove its buttons, clear the marks it left on the anchors (otherwise this instance
  // believes every card is already done) and tell the user what really fixes it: reload the page.
  function clearStaleState() {
    let orphans = 0;
    for (const el of document.querySelectorAll('.' + BTN_CLASS)) { el.remove(); orphans++; }
    if (orphans) for (const anchor of candidates()) delete anchor[HANDLED];
    return orphans;
  }

  function showReloadHint() {
    if (document.getElementById('ptp-reload-hint')) return;
    const bar = document.createElement('div');
    bar.id = 'ptp-reload-hint';
    bar.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.textContent = 'PeerPorter was reloaded - these buttons may be from the previous copy.';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Reload this page';
    btn.addEventListener('click', () => location.reload());
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ptp-reload-close';
    close.textContent = '\u00d7';
    close.setAttribute('aria-label', 'Dismiss');
    close.addEventListener('click', () => bar.remove());
    bar.append(text, btn, close);
    (document.body || document.documentElement).appendChild(bar);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  for (const name of ['yt-navigate-finish', 'yt-page-data-updated', 'yt-first-paint', 'yt-player-updated']) {
    document.addEventListener(name, schedule, true);
  }
  window.addEventListener('focus', schedule);

  if (clearStaleState() > 0) showReloadHint();
  initState();
  scan();
})();
