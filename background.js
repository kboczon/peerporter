'use strict';

/*
 * PeerTube Tube Import - background script (Firefox MV3 event script).
 *
 * PeerTube's REST API accepts only an "Authorization: Bearer <token>" header;
 * a session cookie is rejected with 401. So we obtain an OAuth token with the
 * password grant once (settings page) and keep it alive with the refresh token
 * (access ~24 h, refresh 28 d and re-issued on every refresh).
 */

const IMPORT_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // remember queued videos for 30 days
const CHANNEL_CACHE_MS = 10 * 60 * 1000;
const DEFAULTS = { privacy: 4 };                  // 4 = Internal

const KEYS = [
  'instance', 'clientId', 'clientSecret', 'accessToken', 'refreshToken', 'expiresAt',
  'username', 'channelId', 'channelName', 'privacy', 'notify', 'imported', 'channelsCache'
];

const state = () => browser.storage.local.get(KEYS);
const save = (patch) => browser.storage.local.set(patch);

function cleanHost(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .replace(/\/+$/, '');
}
const originOf = (host) => 'https://' + cleanHost(host);
// Host permission strings must carry a path ("https://host/*"), while fetch URL bases
// must not. Using one helper for both makes browser.permissions.* throw a TypeError.
const permissionOf = (host) => 'https://' + cleanHost(host) + '/*';

function statusHint(status) {
  if (status === 401) return 'PeerTube refused the credentials or token - press Connect again in settings';
  if (status === 403) return 'this account may not import into that channel';
  if (status === 429) return 'too many requests, try again later';
  return '';
}

async function httpError(res, fallback) {
  let detail = '';
  try {
    const body = await res.text();
    try {
      const j = JSON.parse(body);
      detail = j.detail || j.title || j.error || '';
      if (detail && typeof detail !== 'string') detail = JSON.stringify(detail);
    } catch (e) {
      detail = body;
    }
  } catch (e) { /* no readable body */ }
  detail = String(detail || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const parts = [fallback + ' (HTTP ' + res.status + ')', detail, statusHint(res.status)];
  return { code: 'http_' + res.status, status: res.status, message: parts.filter(Boolean).join(' - ') };
}

// ---------- auth ----------

async function requestToken(host, params) {
  const res = await fetch(originOf(host) + '/api/v1/users/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: new URLSearchParams(params).toString()
  });
  if (!res.ok) throw await httpError(res, 'PeerTube login failed');
  return res.json();
}

async function currentToken(forceRefresh) {
  const s = await state();
  if (!s.instance) {
    throw { code: 'not_configured', message: 'Not set up yet - open the extension settings and connect to your PeerTube instance.' };
  }
  if (!s.refreshToken) {
    throw { code: 'not_logged_in', message: 'Not logged in - open the extension settings and press Connect.' };
  }
  const stillValid = s.accessToken && s.expiresAt && Date.now() < s.expiresAt - 60000;
  if (!forceRefresh && stillValid) return s;

  let tok;
  try {
    tok = await requestToken(s.instance, {
      client_id: s.clientId,
      client_secret: s.clientSecret,
      grant_type: 'refresh_token',
      response_type: 'code',
      refresh_token: s.refreshToken
    });
  } catch (e) {
    await save({ accessToken: null, expiresAt: 0 });
    throw { code: 'refresh_failed', message: 'PeerTube session is no longer valid - open settings and press Connect again. ' + (e && e.message ? e.message : e) };
  }
  const patch = {
    accessToken: tok.access_token,
    expiresAt: Date.now() + Number(tok.expires_in || 3600) * 1000
  };
  if (tok.refresh_token) patch.refreshToken = tok.refresh_token;
  await save(patch);
  return Object.assign({}, s, patch);
}

async function api(path, options, opts) {
  options = options || {};
  opts = opts || {};
  let s = await currentToken(Boolean(opts.forceRefresh));
  const send = (token) => fetch(originOf(s.instance) + path, Object.assign({}, options, {
    headers: Object.assign({ 'Accept': 'application/json' }, options.headers || {}, { 'Authorization': 'Bearer ' + token })
  }));
  let res = await send(s.accessToken);
  if (res.status === 401 && !opts.noRetryAuth) {
    s = await currentToken(true);
    res = await send(s.accessToken);
  }
  return res;
}

async function hasHostPermission(host) {
  // Ask, never here: Firefox only allows permissions.request() from a user-input handler,
  // and a background worker never has one. The settings page asks; we only check.
  return browser.permissions.contains({ origins: [permissionOf(host)] });
}

async function login(instanceInput, username, password) {
  const host = cleanHost(instanceInput);
  if (!host) throw { code: 'bad_host', message: 'Enter the instance hostname, for example youtube.wtools.us' };
  if (!username || !password) throw { code: 'bad_credentials', message: 'Username and password are both required.' };

  if (!await hasHostPermission(host)) {
    throw { code: 'no_permission', message: 'No access to ' + host + ' yet - open the extension settings and press "Connect and load my channels"; that is where Firefox asks for permission.' };
  }

  const res = await fetch(originOf(host) + '/api/v1/oauth-clients/local', { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw await httpError(res, 'Could not reach ' + host);
  const clients = await res.json();

  const tok = await requestToken(host, {
    client_id: clients.client_id,
    client_secret: clients.client_secret,
    grant_type: 'password',
    response_type: 'code',
    username,
    password
  });

  await save({
    instance: host,
    clientId: clients.client_id,
    clientSecret: clients.client_secret,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: Date.now() + Number(tok.expires_in || 86399) * 1000,
    username,
    channelsCache: null
  });

  const me = await api('/api/v1/users/me');
  if (!me.ok) throw await httpError(me, 'Logged in but the account check failed');
  const meBody = await me.json();
  return { instance: host, username: meBody.username, accessTokenExpiresAt: Date.now() + Number(tok.expires_in || 86399) * 1000 };
}

// ---------- channels ----------

async function listChannels(force) {
  const s = await state();
  if (!s.instance) throw { code: 'not_configured', message: 'Connect to your instance first.' };
  const cache = s.channelsCache;
  if (!force && cache && cache.at && cache.username === s.username && Date.now() - cache.at < CHANNEL_CACHE_MS) {
    return { channels: cache.list, cached: true };
  }
  const res = await api('/api/v1/accounts/' + encodeURIComponent(s.username) + '/video-channels?count=100');
  if (!res.ok) throw await httpError(res, 'Could not load your channels');
  const body = await res.json();
  const channels = (body.data || [])
    .map((c) => ({ id: c.id, name: c.name, displayName: c.displayName || c.name }))
    .sort((a, b) => String(a.displayName).localeCompare(String(b.displayName), undefined, { sensitivity: 'base' }));
  await save({ channelsCache: { at: Date.now(), username: s.username, list: channels } });
  return { channels, cached: false };
}

// ---------- import ----------

function youtubeId(input) {
  const raw = String(input || '').trim();
  if (/^[\w-]{11}$/.test(raw)) return raw;
  let u;
  try { u = new URL(raw, 'https://www.youtube.com'); } catch (e) { return null; }
  if (u.hostname === 'youtu.be') {
    const id = u.pathname.split('/')[1];
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  }
  if (!/(^|\.)youtube\.com$/i.test(u.hostname)) return null;
  const v = u.searchParams.get('v');
  if (v && /^[\w-]{11}$/.test(v)) return v;
  const m = u.pathname.match(/^\/(?:shorts|live|embed|v)\/([\w-]{11})/);
  return m ? m[1] : null;
}

function pruneImported(imported) {
  const out = {};
  for (const [id, info] of Object.entries(imported || {})) {
    if (info && Date.now() - Number(info.ts) < IMPORT_TTL_MS) out[id] = info;
  }
  return out;
}

async function importToPeerTube(url, title) {
  const s = await state();
  if (!s.channelId) throw { code: 'no_channel', message: 'Pick your default channel in the extension settings first.' };

  const id = youtubeId(url);
  if (!id) throw { code: 'bad_url', message: 'No YouTube video id found in: ' + url };

  const imported = s.imported || {};
  const previous = imported[id];
  if (previous && Date.now() - Number(previous.ts) < IMPORT_TTL_MS) {
    return {
      duplicate: true,
      id,
      videoUrl: previous.videoUrl,
      message: 'Already queued on ' + new Date(Number(previous.ts)).toLocaleString()
    };
  }

  const configuredPrivacy = Number(s.privacy);
  const payload = {
    targetUrl: 'https://www.youtube.com/watch?v=' + id,
    channelId: Number(s.channelId),
    privacy: [1, 2, 3, 4].includes(configuredPrivacy) ? configuredPrivacy : DEFAULTS.privacy
  };
  const name = String(title || '').trim();
  if (name && name.length <= 120) payload.name = name;

  const res = await api('/api/v1/videos/imports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw await httpError(res, 'PeerTube rejected the import');

  let body = {};
  try { body = await res.json(); } catch (e) { body = {}; }
  const video = body.video || (body.videoImport && body.videoImport.video) || null;
  const videoUrl = video && video.shortUUID
    ? originOf(s.instance) + '/w/' + video.shortUUID
    : originOf(s.instance) + '/a/videos/list-remote';
  const importId = (body.videoImport && body.videoImport.id) || body.id || null;

  imported[id] = { ts: Date.now(), videoUrl };
  await save({ imported: pruneImported(imported) });

  await notify('Import queued', (name || id) + '  ->  ' + (s.channelName || 'channel ' + s.channelId));
  return { id, importId, videoUrl, name: (video && video.name) || name, message: 'Queued for import' };
}

// ---------- settings helpers ----------

async function saveSettings(patch) {
  const out = {};
  if (patch.channelId !== undefined && patch.channelId !== null && patch.channelId !== '') {
    out.channelId = Number(patch.channelId);
    out.channelName = String(patch.channelName || '').slice(0, 120);
  }
  if (patch.privacy !== undefined) out.privacy = Number(patch.privacy);
  if (patch.notify !== undefined) out.notify = Boolean(patch.notify);
  if (Object.keys(out).length === 0) throw { code: 'nothing_to_save', message: 'Nothing to save.' };
  await save(out);
  return { saved: Object.keys(out) };
}

async function statusInfo() {
  const s = await state();
  return {
    instance: s.instance || null,
    username: s.username || null,
    loggedIn: Boolean(s.accessToken || s.refreshToken),
    accessTokenExpiresAt: s.expiresAt || 0,
    channelId: s.channelId || null,
    channelName: s.channelName || null,
    privacy: Number(s.privacy || DEFAULTS.privacy),
    notify: s.notify !== false,
    importedCount: Object.keys(s.imported || {}).length,
    hostPermission: s.instance ? await browser.permissions.contains({ origins: [permissionOf(s.instance)] }) : false
  };
}

async function disconnect() {
  await save({ accessToken: null, refreshToken: null, clientSecret: null, expiresAt: 0, channelsCache: null });
  return { ok: true };
}

// ---------- ui feedback ----------

async function notify(title, message) {
  const s = await state();
  if (s.notify === false) return;
  try {
    await browser.notifications.create('ptti-' + Date.now(), {
      type: 'basic',
      iconUrl: browser.runtime.getURL('icons/icon.svg'),
      title: 'PeerTube import: ' + title,
      message: String(message || '').slice(0, 200)
    });
  } catch (e) {
    console.debug('[PeerTube Tube Import] notification unavailable:', e);
  }
}

async function flashBadge(text, color) {
  try {
    await browser.action.setBadgeBackgroundColor({ color });
    await browser.action.setBadgeText({ text });
    setTimeout(() => browser.action.setBadgeText({ text: '' }).catch(() => {}), 4000);
  } catch (e) { /* badge is cosmetic */ }
}

async function importActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || !tab.url) throw { code: 'no_tab', message: 'No active tab to import.' };
  if (!/(youtube\.com|youtu\.be)/i.test(tab.url)) {
    throw { code: 'not_youtube', message: 'Open a YouTube video page first - this button imports the page you are on.' };
  }
  return importToPeerTube(tab.url, tab.title);
}

// ---------- message router ----------

const HANDLERS = {
  'pt:import': (m) => importToPeerTube(m.url, m.title),
  'pt:login': (m) => login(m.instance, m.username, m.password),
  'pt:channels': (m) => listChannels(Boolean(m.force)),
  'pt:save-settings': (m) => saveSettings(m),
  'pt:status': () => statusInfo(),
  'pt:disconnect': () => disconnect(),
  'pt:clear-imported': async () => { await save({ imported: {} }); return { cleared: true }; },
  'pt:state': async () => {
    const s = await state();
    return {
      ready: Boolean(s.instance && s.refreshToken && s.channelId),
      instance: s.instance || null,
      channelName: s.channelName || null,
      imported: Object.keys(s.imported || {})
    };
  }
};

browser.runtime.onMessage.addListener(async (msg) => {
  const handler = msg && HANDLERS[msg.type];
  if (!handler) return { ok: false, code: 'unknown_message', message: 'Unknown request: ' + (msg && msg.type) };
  try {
    const data = await handler(msg);
    if (msg.type === 'pt:import') flashBadge('OK', '#2e7d32');
    return Object.assign({ ok: true }, data || {});
  } catch (e) {
    const err = (e && e.message) ? e : { code: 'exception', message: String(e) };
    console.warn('[PeerTube Tube Import]', msg.type, err.code, err.message);
    if (msg.type === 'pt:import') flashBadge('!', '#c62828');
    if (err.code === 'http_401' || err.code === 'refresh_failed' || err.code === 'not_logged_in') {
      notify('Login needed', err.message);
    }
    return { ok: false, code: err.code, message: err.message };
  }
});

async function handleManualImport() {
  try {
    const result = await importActiveTab();
    flashBadge('OK', '#2e7d32');
    await notify(result.duplicate ? 'Already queued' : 'Import queued', result.message || result.videoUrl || '');
    return Object.assign({ ok: true }, result);
  } catch (e) {
    const err = (e && e.message) ? e : { code: 'exception', message: String(e) };
    console.warn('[PeerTube Tube Import] toolbar import failed:', err.code, err.message);
    flashBadge('!', '#c62828');
    await notify('Import failed', err.message);
    return { ok: false, code: err.code, message: err.message };
  }
}

browser.action.onClicked.addListener(handleManualImport);
browser.commands.onCommand.addListener((command) => {
  if (command === 'import-current-tab') handleManualImport();
});
