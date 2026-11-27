# reveal.js fixture

Real outputs of [reveal.js](https://revealjs.com), used by
`src/preview/real-tools.browser.test.ts` (#694, #709). The tests check that a
page number in the address opens that page and follows the reader as pages
turn (F03-AC187 to F03-AC190).

- Sources: `src/<name>.html`. Each has five pages, with a word of its own.
  `index.html` is the starter's defaults (no hash option, so reveal.js does
  not write the address). The others differ in how they initialize reveal.js:
  `hash.html` (`hash: true`), `one-based.html` (`hashOneBasedIndex: true`),
  `fragments.html` (page 3 shows two lines one at a time).
- Tool and version: `reveal.js@6.0.2`, locked in `package-lock.json`. The
  files of its `dist/` that the pages use are copied into each output.
- Outputs: `dist/` (from `index.html`, with a theme) and `dist-<name>/` (from
  `src/<name>.html`, without the theme, to keep the repository small).
- Rebuild: `scripts/fixtures/tools/revealjs/build.sh` (needs Node and npm; it
  installs in a temporary copy).
- The `dist` folders are generated. Do not edit them by hand; change a source
  or the version, and rebuild.
