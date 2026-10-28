'use strict';

/* Toolbar popup. Exists because the icon used to have no door to the settings page at all:
 * clicking it silently imported the current page, and on a temporary install the settings
 * page had no visible entry either. */

const $ = (id) => document.getElementById(id);
const send = (msg) => browser.runtime.sendMessage(msg);

function videoIdOf(url) {
  const m = String(url || '').match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/live\/|\/embed\/)([\w-]{11})/);
  return m ? m[1] : null;
}

async function activeTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0];
}

function setState(text, bad) {
  const el = $('state');
  el.textContent = text;
  el.classList.toggle('bad', Boolean(bad));
}

function setHint(text, bad) {
  const el = $('hint');
  el.textContent = text || '';
  el.classList.toggle('err', Boolean(bad));
}

async function init() {
  const [status, tab] = await Promise.all([send({ type: 'pt:status' }), activeTab()]);
  const ok = Boolean(status && status.ok);
  const connected = ok && status.loggedIn && Boolean(status.channelId);
  const id = videoIdOf(tab && tab.url);

  if (!ok) setState('Extension is not responding.', true);
  else if (!status.loggedIn) setState('Not connected to PeerTube yet.', true);
  else if (!status.channelId) setState('Connected, but no channel chosen.', true);
  else setState('Will import into: ' + (status.channelName || ('channel ' + status.channelId)));

  $('settings').addEventListener('click', () => browser.runtime.openOptionsPage());

  const btn = $('import');
  if (!id) {
    btn.disabled = true;
    setHint('Open a YouTube video first, or use the PT button on a thumbnail.');
  } else if (!connected) {
    btn.disabled = true;
    setHint('Open Settings and press Connect first.');
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Sending...';
    const r = await send({
      type: 'pt:import',
      url: 'https://www.youtube.com/watch?v=' + id,
      title: (tab && tab.title) || ''
    });
    if (r && r.ok) {
      btn.textContent = r.duplicate ? 'Already queued' : 'Queued for import';
      setHint(r.message || (r.videoUrl ? 'PeerTube page: ' + r.videoUrl : 'PeerTube is downloading it now.'));
    } else {
      btn.disabled = false;
      btn.textContent = 'Try again';
      setHint((r && r.message) || 'Import failed.', true);
    }
  });
}

init();
