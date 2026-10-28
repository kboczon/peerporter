'use strict';

/* Settings page. The permission prompt for the instance origin must be asked
 * from here, because browser.permissions.request() needs the user gesture. */

const $ = (id) => document.getElementById(id);
const send = (msg) => browser.runtime.sendMessage(msg);

function log(text, kind) {
  const li = document.createElement('li');
  li.textContent = new Date().toLocaleTimeString() + '  ' + text;
  if (kind) li.className = kind;
  $('log').prepend(li);
  while ($('log').children.length > 12) $('log').lastElementChild.remove();
}

const PRIVACY_NAMES = { 1: 'Public', 2: 'Unlisted', 3: 'Private', 4: 'Internal' };

function renderStatus(s) {
  $('s-instance').textContent = s.instance || 'not configured';
  $('s-user').textContent = s.loggedIn ? (s.username || 'yes') : 'no';
  // Written as if/else on purpose: with a nested ternary the "+" binds tighter than ":",
  // which used to attach the date to the expired branch only and printed a bare
  // "valid until " for a perfectly healthy token.
  const expiry = s.accessTokenExpiresAt;
  if (!expiry) {
    $('s-token').textContent = '-';
  } else {
    const when = new Date(expiry).toLocaleString();
    $('s-token').textContent = expiry > Date.now()
      ? 'valid until ' + when
      : 'expired ' + when + ' - refreshes on the next import';
  }
  $('s-channel').textContent = s.channelName ? s.channelName + ' (id ' + s.channelId + ')' : 'not chosen';
  $('s-privacy').textContent = PRIVACY_NAMES[s.privacy] || String(s.privacy);
  $('s-perm').textContent = s.instance ? (s.hostPermission ? 'granted for ' + s.instance : 'MISSING - press Connect') : '-';
  $('s-imports').textContent = String(s.importedCount || 0);
}

function renderChannels(channels, selectedId) {
  const sel = $('channels');
  sel.textContent = '';
  if (!channels.length) {
    const opt = document.createElement('option');
    opt.textContent = 'This account has no channel yet - create one on PeerTube first';
    sel.append(opt);
    return;
  }
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '- choose a channel -';
  sel.append(blank);
  for (const c of channels) {
    const opt = document.createElement('option');
    opt.value = String(c.id);
    opt.textContent = c.displayName + '  (@' + c.name + ')';
    if (Number(selectedId) === Number(c.id)) opt.selected = true;
    sel.append(opt);
  }
}

async function refreshStatus() {
  const r = await send({ type: 'pt:status' });
  if (r && r.ok) {
    renderStatus(r);
    if (r.instance) $('instance').value = r.instance;
    if (r.username) $('username').value = r.username;
    $('privacy').value = String(r.privacy);
    $('notify').checked = r.notify !== false;
  }
  return r && r.ok ? r : null;
}

async function loadChannels(force) {
  const r = await send({ type: 'pt:channels', force: Boolean(force) });
  if (!r || !r.ok) {
    log((r && r.message) || 'Could not load channels', 'err');
    return false;
  }
  const status = await refreshStatus();
  renderChannels(r.channels || [], status && status.channelId);
  log('Loaded ' + ((r.channels || []).length) + ' channel(s)' + (r.cached ? ' (cached)' : ''), 'ok');
  return true;
}

$('connect').addEventListener('click', async () => {
  const instance = $('instance').value.trim();
  const username = $('username').value.trim();
  const password = $('password').value;
  // Name the box that is empty. "Fill in instance, username and password" made a grey
  // placeholder look like a filled-in field, and cost a whole debugging session.
  const missing = [];
  if (!instance) missing.push('Instance');
  if (!username) missing.push('Username');
  if (!password) missing.push('Password');
  if (missing.length) { log('Missing: ' + missing.join(', '), 'err'); return; }

  // browser.permissions.* needs a match pattern that carries a path: "https://host/*".
  // "https://host" throws a TypeError, which is what stopped Connect from running.
  const host = instance.replace(/^https?:\/\//i, '').split('/')[0];
  const origin = 'https://' + host + '/*';
  try {
    let granted;
    if (browser.permissions.request) {
      // Call this before any await: Firefox forgets the user input as soon as the handler
      // yields, and throws "permissions.request may only be called from a user input
      // handler". A permission that is already granted resolves true with no prompt.
      granted = await browser.permissions.request({ origins: [origin] });
    } else {
      granted = await browser.permissions.contains({ origins: [origin] });
    }
    if (!granted) { log('Site access for ' + host + ' was not granted, so the extension cannot reach it. Check site permissions in about:preferences.', 'err'); return; }
  } catch (e) {
    log('Permission request failed: ' + e.message, 'err');
    return;
  }

  $('connect').disabled = true;
  const r = await send({ type: 'pt:login', instance, username, password });
  $('connect').disabled = false;
  $('password').value = '';
  if (!r || !r.ok) { log((r && r.message) || 'Login failed', 'err'); await refreshStatus(); return; }
  log('Connected to ' + r.instance + ' as ' + r.username, 'ok');
  await refreshStatus();
  await loadChannels(true);
});

$('save').addEventListener('click', async () => {
  const channelId = $('channels').value;
  const selected = $('channels').selectedOptions[0];
  const patch = { privacy: Number($('privacy').value), notify: $('notify').checked };
  if (channelId) {
    patch.channelId = Number(channelId);
    patch.channelName = (selected ? selected.textContent : '').replace(/\s+\(@.*\)$/, '');
  }
  const r = await send({ type: 'pt:save-settings', ...patch });
  if (!r || !r.ok) { log((r && r.message) || 'Nothing saved', 'err'); return; }
  log('Saved: ' + (channelId ? 'channel "' + patch.channelName + '" and ' : '') +
      'privacy ' + PRIVACY_NAMES[patch.privacy] + ', notifications ' + (patch.notify ? 'on' : 'off'), 'ok');
  await refreshStatus();
});

$('reload-channels').addEventListener('click', () => loadChannels(true));

$('clear-imported').addEventListener('click', async () => {
  await send({ type: 'pt:clear-imported' });
  log('Forgot which videos were queued', 'ok');
  await refreshStatus();
});

$('disconnect').addEventListener('click', async () => {
  await send({ type: 'pt:disconnect' });
  log('Logged out - stored tokens deleted', 'ok');
  await refreshStatus();
});

$('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('connect').click(); });

(async () => {
  const status = await refreshStatus();
  if (status && status.loggedIn) await loadChannels(false);
})();
