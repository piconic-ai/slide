import { expect, test } from 'vitest'
import { COVER_PATH_MAX_LENGTH, coverPathOf } from './cover'

test.each([
  ['<meta property="og:image" content="cover.png">', 'cover.png'],
  [
    "<META CONTENT='./images/Cover.JPG' PROPERTY='OG:Image' />",
    'images/Cover.JPG',
  ],
  ['<meta name="og:image" content="/og.webp">', 'og.webp'],
  [
    '<meta property="og:image" content="a/../b/cover.jpeg?v=2#x">',
    'b/cover.jpeg',
  ],
  ['<meta property="og:image" content="og%20image.png">', 'og image.png'],
  ['<meta property="og:image" content="&#x8868;紙.gif">', '表紙.gif'],
  // Written decomposed, as macOS file names are; stored paths are NFC.
  ['<meta property="og:image" content="cafe\u0301.png">', 'caf\u00e9.png'],
  [
    '<meta property="og:image" content="https://elsewhere.example/a.png"><meta property="og:image" content="mine.png">',
    'mine.png',
  ],
  [
    '<meta property="og:title" content="t.png"><meta property="og:image" content="real.png">',
    'real.png',
  ],
])(
  'Given %j, When the cover is read, Then it is the deck file %j',
  (html, path) => {
    expect(coverPathOf(html)).toBe(path)
  },
)

test.each([
  ['no og:image', '<title>T</title>'],
  ['an empty value', '<meta property="og:image" content="">'],
  ['no content', '<meta property="og:image">'],
  [
    'another site',
    '<meta property="og:image" content="https://elsewhere.example/a.png">',
  ],
  [
    'a scheme-relative URL',
    '<meta property="og:image" content="//elsewhere.example/a.png">',
  ],
  [
    'backslashes for slashes',
    '<meta property="og:image" content="\\\\elsewhere.example\\a.png">',
  ],
  [
    'a data URL',
    '<meta property="og:image" content="data:image/png;base64,AAAA">',
  ],
  [
    'a script URL',
    '<meta property="og:image" content="javascript:alert(1)//.png">',
  ],
  [
    'a file that is not an image',
    '<meta property="og:image" content="index.html">',
  ],
  ['an SVG', '<meta property="og:image" content="cover.svg">'],
  ['the deck root', '<meta property="og:image" content="/">'],
  ['a broken escape', '<meta property="og:image" content="%E0%A4%A.png">'],
  ['a comment', '<!-- <meta property="og:image" content="old.png"> -->'],
  [
    'a template',
    '<template><meta property="og:image" content="t.png"></template>',
  ],
  [
    'a script',
    '<script>x = \'<meta property="og:image" content="js.png">\'</script>',
  ],
  [
    'a path that is too long',
    `<meta property="og:image" content="${'a'.repeat(COVER_PATH_MAX_LENGTH)}.png">`,
  ],
])('Given %s, When the cover is read, Then there is none', (_case, html) => {
  expect(coverPathOf(html)).toBeNull()
})

test('Given a path of exactly the longest length, When the cover is read, Then it is taken', () => {
  const path = `${'a'.repeat(COVER_PATH_MAX_LENGTH - 4)}.png`

  expect(coverPathOf(`<meta property="og:image" content="${path}">`)).toBe(path)
})
