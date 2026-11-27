# suraido.js fixture

A real output of [suraido.js](https://github.com/L4Ph/suraido), used by
`src/preview/real-tools.browser.test.ts` (#694). The tests record what the
service does with it now; the spec has not decided what it should do.

- Source: `src/index.tsx` (five pages, each with a word of its own), made from
  the `create-suraido@0.4.2` template without its web font, which is fetched
  at run time.
- Tool and version: `suraido.js@0.5.0`, built with `vite@8.4.0` (the template
  uses a Vite Plus alias, which its own CLI refuses to run outside Vite Plus).
  All versions are locked in `package-lock.json`.
- Rebuild: `scripts/fixtures/tools/suraido/build.sh` (needs Node and npm; it
  builds in a temporary copy).
- `dist/` is generated. Do not edit it by hand; change `src/` or the
  dependencies, and rebuild.
