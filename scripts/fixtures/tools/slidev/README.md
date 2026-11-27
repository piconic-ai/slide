# Slidev fixture

A real output of [Slidev](https://sli.dev), used by
`src/preview/real-tools.browser.test.ts` (#694). The tests check that a page
number in the address opens that page and follows the reader (F03-AC191 and F03-AC192).

- Source: `slides.md` (five pages, each with a word of its own).
- Tool and version: `@slidev/cli@53.2.0` with `@slidev/theme-default@0.25.0`,
  run through `npx`.
- Rebuild: `scripts/fixtures/tools/slidev/build.sh`.
- `dist/` is generated. Do not edit it by hand; change `slides.md` or the
  pinned versions in `build.sh`, and rebuild. It holds a `_redirects` file,
  which the service refuses as a file type; the tests leave it out of the
  upload and check that it is refused.
