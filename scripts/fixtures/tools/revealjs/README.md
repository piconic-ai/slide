# reveal.js fixture

A real output of [reveal.js](https://revealjs.com), used by
`src/preview/real-tools.browser.test.ts` (#694). The tests record what the
service does with it now; the spec has not decided what it should do.

- Source: `src/index.html` (five pages, each with a word of its own; the
  starter's defaults, so reveal.js does not write the address).
- Tool and version: `reveal.js@6.0.2`, locked in `package-lock.json`. The
  files of its `dist/` that the page uses are copied into `dist/dist/`.
- Rebuild: `scripts/fixtures/tools/revealjs/build.sh` (needs Node and npm; it
  installs in a temporary copy).
- `dist/` is generated. Do not edit it by hand; change `src/index.html` or the
  version, and rebuild.
