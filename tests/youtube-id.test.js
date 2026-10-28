// PeerTube Tube Import - pure-logic tests. Run with:  node tests/youtube-id.test.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const noop = () => {};
const branch = () => new Proxy({}, { get: () => noop });
const browser = {
  runtime: { onMessage: { addListener: noop }, getURL: (p) => p },
  action: { onClicked: { addListener: noop }, setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  commands: { onCommand: { addListener: noop } },
  storage: { local: { get: async () => ({}), set: async () => {} } },
  permissions: { contains: async () => true, request: async () => true },
  notifications: { create: async () => true },
  tabs: { query: async () => [] }
};
// run the script body and hand back the pure helper
const { youtubeId, pruneImported, originOf, permissionOf } =
  new Function('browser', src + '\nreturn { youtubeId, pruneImported, originOf, permissionOf };')(browser);

const cases = [
  ['https://www.youtube.com/watch?v=R4dUq9yG2L8&pp=ugUEEgJlbg%3D%3D', 'R4dUq9yG2L8'],
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ['/watch?v=abCD12345_-&t=42s', 'abCD12345_-'],
  ['https://www.youtube.com/shorts/abcdefGHIJK', 'abcdefGHIJK'],
  ['https://youtube.com/shorts/abcdefGHIJK?feature=share', 'abcdefGHIJK'],
  ['https://youtu.be/zzZZ00yyXX1', 'zzZZ00yyXX1'],
  ['https://www.youtube.com/embed/qqQQ11wwEE2', 'qqQQ11wwEE2'],
  ['https://www.youtube.com/live/VvLiIvEe123?feature=share', 'VvLiIvEe123'],
  ['https://m.youtube.com/watch?v=MmNiOuSiE12', 'MmNiOuSiE12'],
  ['https://www.youtube.com/watch', null],
  ['https://www.youtube.com/@SomeChannel/videos', null],
  ['https://example.com/watch?v=notyoutube', null],
  ['https://www.youtube.com/watch?v=abcdefghijk', 'abcdefghijk'],
  ['https://www.youtube-nocookie.com/embed/abcdefghijk', null],
  ['https://notyoutube.com.evil.ru/watch?v=abcdefghijk', null],
  ['', null]
];
let fail = 0;
for (const [input, want] of cases) {
  const got = youtubeId(input);
  const ok = got === want;
  if (!ok) fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + JSON.stringify(input).padEnd(58) + ' -> ' + String(got) + (ok ? '' : '  (wanted ' + String(want) + ')'));
}
// duplicate-pruning window
const old = Date.now() - 31 * 24 * 3600 * 1000, recent = Date.now() - 60000;
const pruned = pruneImported({ oldId: { ts: old }, keepId: { ts: recent } });
const pruneOk = !pruned.oldId && pruned.keepId;
if (!pruneOk) fail++;
console.log((pruneOk ? 'PASS ' : 'FAIL ') + 'pruneImported drops entries older than 30 days, keeps fresh ones');
// Permission strings: browser.permissions.contains()/request() reject "https://host"
// because a host permission must carry a path. FF_ORIGIN_RE is the pattern Firefox
// quotes in that TypeError, taken from the real 2026-10-28 failure on Connect.
const FF_ORIGIN_RE = /^(https?|wss?|file|ftp|\*):\/\/(\*|\*\.[^*/]+|[^*/]+)\/.*$/;
for (const [input, want] of [
  ['youtube.wtools.us', 'https://youtube.wtools.us/*'],
  ['https://youtube.wtools.us', 'https://youtube.wtools.us/*'],
  ['https://youtube.wtools.us/', 'https://youtube.wtools.us/*'],
  ['https://youtube.wtools.us/api/v1/videos', 'https://youtube.wtools.us/*']
]) {
  const got = permissionOf(input);
  const ok = got === want && FF_ORIGIN_RE.test(got);
  if (!ok) fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + ('permissionOf(' + JSON.stringify(input) + ')').padEnd(50) + ' -> ' + got);
}
for (const bad of ['youtube.wtools.us', 'https://youtube.wtools.us']) {
  const ok = !FF_ORIGIN_RE.test(bad);
  if (!ok) fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + ('bare "' + bad + '" is rejected by the Firefox pattern').padEnd(50));
}
for (const [input, want] of [['youtube.wtools.us', 'https://youtube.wtools.us'],
                             ['https://youtube.wtools.us/', 'https://youtube.wtools.us']]) {
  const got = originOf(input);
  const ok = got === want;
  if (!ok) fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + ('originOf(' + JSON.stringify(input) + ') stays a URL base').padEnd(50) + ' -> ' + got);
}
// Permission calls must stay where Firefox allows them. Both rules below were broken on
// 2026-10-28 and each break stopped Connect with an opaque error dialog.
//  - background.js must never call permissions.request(): a background worker never has a
//    user input, and Firefox throws "may only be called from a user input handler".
//  - options.js must call request() before any await, so request() comes before contains().
{
  const optSrc = fs.readFileSync(path.join(__dirname, '..', 'options.js'), 'utf8');
  const reqIdx = optSrc.indexOf('browser.permissions.request(');
  const conIdx = optSrc.indexOf('browser.permissions.contains(');
  // strip full-line comments so a comment that merely mentions the API is not a finding
  const bgCode = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const checks = [
    ['background.js never calls permissions.request', !/permissions\.request/.test(bgCode)],
    ['options.js requests permission before checking it', reqIdx > -1 && (conIdx === -1 || reqIdx < conIdx)],
    ['options.js has no awaited contains()-then-request() chain',
      !/await\s+browser\.permissions\.contains\([\s\S]{0,140}\|\|[\s\S]{0,140}permissions\.request/.test(optSrc)],
    // A nested ternary once printed "valid until " with no date, because "+" binds tighter
    // than ":" and moved the date into the other branch.
    ['options.js never prints a dangling "valid until " prefix', !/'valid until '\s*:/.test(optSrc)],
    ['options.js appends the date after "valid until "', optSrc.includes("'valid until ' + when")]
  ];
  for (const [name, ok] of checks) {
    if (!ok) fail++;
    console.log((ok ? 'PASS ' : 'FAIL ') + name.padEnd(50));
  }
}
console.log(fail === 0 ? '\nALL TESTS PASSED' : '\n' + fail + ' TEST(S) FAILED');
process.exit(fail === 0 ? 0 : 1);
