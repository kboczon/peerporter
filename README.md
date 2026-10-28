# PeerTube Tube Import (Firefox)

Puts a small **PT** button on every YouTube thumbnail. One click queues that video into your
PeerTube channel.

| | |
|---|---|
| Home page | https://github.com/kboczon/peertube-tube-import |
| Issues | https://github.com/kboczon/peertube-tube-import/issues |
| Privacy policy | [PRIVACY.md](PRIVACY.md) |
| License | MIT - see [LICENSE](LICENSE) |
| Browser | Firefox 140 or newer (desktop) |
| Server | PeerTube 8.x (built and tested against 8.3.1) |

## What it does

- **PT** button on each thumbnail: home feed, search results, subscriptions, channel pages,
  the watch-page sidebar and Shorts. The home-feed markup was verified live; the other card
  types are covered by the fallback selectors at the top of `content.js`.
- **Toolbar popup**: shows which channel it will import into, one button to import the video you
  are watching, one button to reach settings.
- **`Alt+Shift+P`**: import the video in the current tab, without touching the mouse.
- **Duplicate guard**: a video id is remembered for 30 days, so a second click cannot queue it twice.

Button colours: grey `...` = sending, green tick = queued, blue tick = already queued (click it to
open the PeerTube page), red `!` = failed - hover it for the reason, and it unlocks after a few
seconds so you can retry.

## Install

**Testing without signing** (temporary, disappears when Firefox restarts):

1. `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on...** -> pick `manifest.json` in this folder
3. Open YouTube - the buttons appear. No build step, no npm needed.

**Permanent install**: sign the package (see [Signing](#signing)) and install the resulting XPI with
`about:addons` -> gear -> **Install Add-on From File...**. Release Firefox refuses unsigned packages.

## First run

1. Click the toolbar icon -> **Settings and Connect**
2. Instance: your hostname only, e.g. `youtube.wtools.us` (the grey text in the box is only an
   example, not a value). Then your PeerTube username and password -> **Connect and load my channels**
3. **Allow** the Firefox prompt that grants access to that one site
4. Pick the channel, choose privacy, **Save**
5. Browse YouTube and click **PT**

The privacy default is **Internal** (PeerTube id 4): an import never lands public by accident.

## How it authenticates

PeerTube's API accepts only an `Authorization: Bearer` header - a session cookie gets `401` - and
PeerTube 8 has no permanent personal API token. So:

1. Press **Connect** once. The add-on reads `/api/v1/oauth-clients/local`, then posts the password
   grant to `/api/v1/users/token`.
2. It stores the access token (~24 h) and the refresh token (28 d). Your **password is never stored** -
   the field is cleared right after that one request.
3. Before each call it checks expiry and refreshes with `grant_type=refresh_token`. PeerTube returns a
   fresh refresh token every time, so the 28-day window slides: use it at least once a month and you
   never type the password again.

Note that `permissions.request()` must run inside a user gesture, so the grant is asked by the
settings page, never by the background worker.

## Privacy

Nothing leaves your browser except a request to the PeerTube instance you chose. No analytics, no
tracking, no author-controlled server. Full details: [PRIVACY.md](PRIVACY.md).

## Verification status

| Check | Result |
|---|---|
| End-to-end import | **Proven on a live instance**: PT click -> `POST /api/v1/videos/imports` -> video created on the chosen channel with privacy Internal, YouTube publish date, description, tags, category and language preserved by PeerTube's own fetcher |
| Buttons render | **Proven** on the real home feed and on Shorts cards (screenshot at native resolution) |
| Connect + silent refresh | **Proven**: status shows a real expiry ~24 h out; token refresh path exercised |
| `node tests/youtube-id.test.js` | all assertions pass: 17 YouTube URL cases, the 30-day duplicate window, permission-string shape against Firefox's own pattern, and static guards for the permission-call rules |
| `web-ext lint` | 0 errors, 0 notices, 1 warning (`KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION` - correct, this add-on is desktop-only) |
| `node --check` | clean on `background.js`, `content.js`, `options.js`, `popup.js` |

PeerTube endpoints checked live against PeerTube 8.3.1: `oauth-clients/local`, `users/token`
(password and refresh_token grants), `users/me`, `accounts/<user>/video-channels?count=100`,
`POST videos/imports`.

### Bugs found and fixed while testing on the live instance

Kept here because they are the interesting part of this add-on's history, and each is now covered
by a test or a guard:

1. `browser_specific_settings.gecko.data_collection_permissions.data_types` is not a valid manifest
   property - Firefox warns "An unexpected property was found". `web-ext lint` cannot see this,
   because its bundled schema does not know that key at all.
2. Host-permission strings must carry a path: `https://host` raises a TypeError in
   `permissions.contains()`, `https://host/*` is what Firefox wants. One helper was serving both
   fetch URL bases and permission strings.
3. `permissions.request()` may only be called from a user-input handler: awaiting
   `permissions.contains()` first destroyed the gesture, and a background worker can never ask at all.
4. A `placeholder` in the instance field read as a prefilled value, so Connect was clicked with an
   empty box. The placeholder is now an obviously fake hostname and the error names the empty field.
5. The token status row printed a bare `valid until ` with no date: in a nested ternary `+` binds
   tighter than `:`, so the date had moved into the other branch.
6. Reloading the add-on from `about:debugging` leaves the previous content script running in the
   page, and its buttons answer `!` forever. The new script now removes those orphans and shows a
   reload prompt instead of a silent failure.

## Signing

Unsigned XPIs cannot be installed, so sign once through Mozilla. Use **unlisted** for your own
machines - it stays private and only the XPI you download is usable:

```bash
# one time: create an API key at https://addons.mozilla.org/developers/credentials/
export AMO_API_KEY='<issuer>:<secret>'
cd ~/Projects/peertube-tube-import
npm exec --yes -- web-ext sign --api-key "$AMO_API_KEY" --artifacts-dir dist
# where npx is installed, `npx --yes web-ext sign ...` does the same
```

That produces `dist/peertube-tube-import-*.xpi`. The add-on id is fixed in `manifest.json`
(`peertube-tube-import@wtools.us`), so a re-signed update replaces the old one and keeps settings.

## Development

```bash
node tests/youtube-id.test.js                     # pure logic + static guards, no browser needed
npm exec --yes -- web-ext lint                    # validation (web-ext-config.cjs excludes tests/)
npm exec --yes -- web-ext build --artifacts-dir dist
```

`web-ext sign` and `build` package the whole source directory, which is why `web-ext-config.cjs`
excludes `tests/`: the test harness uses the `Function` constructor to reach the pure helpers, and
must not ship inside the add-on.

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest, Firefox id, permissions, data-collection declaration |
| `background.js` | PeerTube API client: login, silent refresh, channels, `POST /api/v1/videos/imports` |
| `content.js` | finds thumbnails, injects the button, handles clicks, state and stale-button recovery |
| `content.css` | button and reload-prompt look |
| `popup.html` / `popup.js` | toolbar popup |
| `options.html` / `options.js` | settings page |
| `tests/youtube-id.test.js` | pure-logic tests plus static guards for the Firefox permission rules |
| `icons/icon.svg` | toolbar and notification icon |
| `PRIVACY.md`, `LICENSE` | privacy policy, MIT license |

Permissions and why: `storage` (tokens, channel choice), `notifications` (queue feedback),
`activeTab` (popup and shortcut import of the current tab), `<all_urls>` as **optional** - it is
asked only for your own instance host, when you press Connect, because the add-on cannot know which
server you will use.

## Known limits

- The import is asynchronous. The green tick means "queued", not "watchable yet".
- PeerTube must have working YouTube import cookies, otherwise the queue entry fails server-side.
- YouTube Music (`music.youtube.com`) is deliberately excluded.
- YouTube changes its markup now and then. The selectors live at the top of `content.js`
  (`CANDIDATES` and `CARDS`); add the new class name there. Current markup uses
  `a.ytLockupViewModelContentImage` inside `yt-lockup-view-model`, in light DOM.
