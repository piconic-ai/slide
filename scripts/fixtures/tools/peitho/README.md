# peitho fixture

A real output of [peitho](https://github.com/mizzy/peitho), used by
`src/preview/real-tools.browser.test.ts` (#694).

- Source: `deck.md` (five pages, each with a word of its own).
- Tool and version: peitho 1.48.0 (Homebrew `mizzy/tap/peitho`).
- Rebuild: `scripts/fixtures/tools/peitho/build.sh` (refuses another version).
- `dist/` is generated. Do not edit it by hand; change `deck.md` or the
  pinned version in `build.sh`, and rebuild.
