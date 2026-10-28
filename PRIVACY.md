# Privacy policy - PeerTube Tube Import

Author: Kamil Boczon. Contact: https://github.com/kboczon/peertube-tube-import/issues

## What the extension sends, and to whom

| Data | Sent where | Why |
|---|---|---|
| The YouTube video URL of the video you click, and its page title | Only the PeerTube instance you type in Settings | PeerTube needs the URL to import the video; the title is passed as a suggested name |
| Your PeerTube username, and the OAuth access and refresh tokens | Only that same PeerTube instance | PeerTube's API accepts only a `Bearer` token, and has no permanent personal API token |
| The video ids you queued (30 days) | Nowhere - kept in your browser (`browser.storage.local`) | So a second click cannot queue the same video twice |

Your PeerTube **password is not stored**. It is used for one request when you press Connect and the
field is cleared immediately after.

## What the extension does not do

- no analytics, no counters, no tracking, no crash reporting
- no server of the author's: there is no backend in this project
- no data sent to any third party, and no data sold or shared
- no browsing history, form data or credentials are read from the browser
- no remote code: every script ships inside the package

## Where the data goes

Everything goes between your browser and the PeerTube instance **you** chose. That instance is
administered by its own operator under its own policy. On the developer's own instance
(`youtube.wtools.us`) imported videos are stored with privacy "Internal".

## Removing the data

- Log out in Settings: deletes the stored tokens from the browser.
- "Forget which videos were queued": deletes the 30-day duplicate list.
- Uninstalling the add-on removes everything it stored.
- Anything already imported lives on your PeerTube instance and is deleted there.
