# Submitting to addons.mozilla.org

Package to upload: `dist/peertube_tube_import-0.1.0.zip` (built with
`npm exec --yes -- web-ext build --artifacts-dir dist`).

Current state of the package, as measured:

| Check | Value |
|---|---|
| `web-ext lint` | 0 errors, 0 notices, 1 warning (`KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION`) |
| Tests | 30 assertions, 0 failures (`node tests/youtube-id.test.js`) |
| Files inside the zip | 12 (no `tests/`, no build output) |
| Add-on id | `peertube-tube-import@wtools.us` (fixed in `manifest.json`) |
| Manifest description | 104 characters |

## 1. Choose how to publish

| Route | How | Result |
|---|---|---|
| **Unlisted** (self-service, no review queue) | `web-ext sign` with an AMO API key, then install the XPI it returns | works on any Firefox, updates are not pushed by AMO |
| **Listed** (what "Publish to Mozilla" means) | upload the zip at <https://addons.mozilla.org/developers/> | appears in the public directory, AMO reviews it and pushes updates |

Both can coexist for the same add-on id. Do **unlisted first** if you want it on your machines today;
do **listed** for the public release.

For unlisted:

```bash
export AMO_API_KEY='<issuer>:<secret>'   # https://addons.mozilla.org/developers/credentials/
npm exec --yes -- web-ext sign --api-key "$AMO_API_KEY" --artifacts-dir dist
```

## 2. Field by field (AMO "Add a new extension" form)

**Name**

    PeerTube Tube Import

**Platform** - Firefox. **Release channel** - Listed.

**Category** - "Appearances Browsing" fits best (it changes what YouTube shows);
"Adds, Tools & Actions" is the other defensible pick.

**License** - MIT (the form has an "Other" box - write `MIT`, matching `manifest.json` which says
`license: "MIT"`).

**Website / Support / Privacy policy URLs**

    https://github.com/kboczon/peertube-tube-import
    https://github.com/kboczon/peertube-tube-import/issues
    https://github.com/kboczon/peertube-tube-import/blob/main/PRIVACY.md

**Summary** (the short one). This is the manifest description, 104 characters:

    Adds an import button to every YouTube thumbnail. One click queues the video into your PeerTube channel.

**Full description**

    Puts a small "PT" button on every YouTube thumbnail. One click queues that video into a PeerTube
    channel you choose - no copy-paste of URLs, no re-typing of titles.

    It works on the home feed, search results, subscriptions, channel pages, the watch-page sidebar
    and Shorts. The toolbar button imports the video you are watching, and Alt+Shift+P does the same
    without the mouse.

    Your PeerTube credentials are used once, when you press Connect, to obtain OAuth tokens; the
    password is never stored. PeerTube's API accepts only a Bearer token and PeerTube 8 has no
    permanent personal API token, so the add-on refreshes the token silently (the refresh token is
    valid 28 days and is renewed on use). Everything goes between your browser and the PeerTube
    instance you type in - there is no server behind this add-on.

    Imports default to privacy "Internal", so nothing lands public by accident. A video you queued is
    remembered for 30 days so a second click cannot queue it twice.

    Requires Firefox 140 or newer and a PeerTube 8.x instance.

**Version notes** ("What's new")

    First release.

## 3. Permission justification (reviewers read this)

    <all_urls> is declared in "optional_permissions", never in "permissions". The add-on cannot know
    which PeerTube host a user runs, so it asks for exactly one site, only when the user presses
    "Connect", and the prompt names that host. All PeerTube calls go to that one host. "storage"
    keeps the OAuth tokens, the chosen channel and a 30-day list of queued video ids, all locally.
    "activeTab" is used by the toolbar popup and the Alt+Shift+P shortcut to read the URL and page
    title of the tab the user is looking at, at the moment they act. "notifications" reports the
    result of an import. No browsing history, no cookies, no form data, no web requests are read.

## 4. Data collection declaration

The extension does **not** collect or store data on any server. Answer "no" to the collection
questions, and if the form still wants a statement:

    No data is collected, transmitted to the developer, or stored on any server. The OAuth tokens and
    the queue history stay in the browser's local storage. The only data sent anywhere is the YouTube
    video URL (and its page title as a suggested name) from the user's browser to the user's own
    PeerTube instance, which is what PeerTube's import API requires. The password entered on the
    Connect screen is used for one token request and is never stored.

The `data_collection_permissions.required` list in `manifest.json` names `Authentication credentials`
and `Basic interaction data` for the same reason - it is required in Firefox 140+, while the
`data_types` key does not exist and must stay out of the manifest.

## 5. Assets

- **Screenshots**: AMO wants at least one. Capture YouTube with the buttons visible
  (1280x720 or larger, PNG/JPG).
- **Promo tile**: optional.
- Icon: the add-on ships `icons/icon.svg`; AMO shows its own tile for listings.

## 6. Before you press submit

- [ ] `node tests/youtube-id.test.js` passes
- [ ] `web-ext lint` has 0 errors
- [ ] the zip contains no `tests/` (12 files)
- [ ] the PRIVACY.md URL above is reachable without login (it is, the repo is public)
- [ ] the privacy policy text still matches the code (no new network targets since it was written)
- [ ] expect a reviewer question about `<all_urls>`; the text in section 3 is the answer

## 7. After approval

Install on each machine from the listing, or with the unlisted XPI:
`about:addons` -> gear -> **Install Add-on From File...**

Because the id is fixed, a newer signed version replaces the old one and keeps the stored tokens and
settings.

## 8. If review rejects it

Reviewers usually ask for one of: a shorter justification, a video/screenshot showing the extension
working, or removal of a broad permission. Reply in the "Message Mozilla" box of the submission
version page - the add-on stays in the queue while you answer.
