// Option defaults for `web-ext lint`, `web-ext sign` and `web-ext build`.
// tests/ holds the node test harness, which loads background.js with the Function
// constructor to reach its pure helpers. That file must not be part of the packaged
// add-on, and its Function use must not be reported as a finding.
// (web-ext 8 refuses a ".js" config file, and the key is ignoreFiles, not ignore.)
module.exports = {
  ignoreFiles: ['tests/**', 'web-ext-config.cjs', 'peertube-tube-import-*.xpi'],
};
