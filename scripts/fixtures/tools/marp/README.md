# Marp fixture

A real output of [Marp CLI](https://github.com/marp-team/marp-cli), used by
`src/preview/real-tools.browser.test.ts` (#694). Marp keeps the page in the
fragment (`#N`, counting from 1), the form the service reads first, so this is
the reference for slides that behave as expected.

- Source: `deck.md` (five pages, each with a word of its own).
- Tool and version: `@marp-team/marp-cli@4.5.1`, run through `npx`.
- Rebuild: `scripts/fixtures/tools/marp/build.sh`.
- `dist/` is generated. Do not edit it by hand; change `deck.md` or the pinned
  version in `build.sh`, and rebuild.
