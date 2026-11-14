import { expect, test } from 'vitest'
import { TITLE_SCAN_BYTES } from './title'
import { DESCRIPTION_MAX_LENGTH, descriptionOf } from './description'

test.each([
  ['<meta name="description" content="Six techniques">', 'Six techniques'],
  ["<META CONTENT='発表の概要' NAME='Description' />", '発表の概要'],
  ['<meta name=description content=short>', 'short'],
  [
    '<meta name="description" content="A &amp; B &lt;3\n  two   lines">',
    'A & B <3 two lines',
  ],
  [
    '<meta name="viewport" content="width=device-width"><meta name="description" content="real">',
    'real',
  ],
  [
    '<meta name="description" content="first"><meta name="description" content="second">',
    'first',
  ],
  [
    '<meta name="description" content=""><meta name="description" content="filled">',
    'filled',
  ],
  ['<meta name="description" content="a > b">', 'a > b'],
  [
    '<!-- <meta name="description" content="old"> --><meta name="description" content="new">',
    'new',
  ],
  [
    '<script>x=\'<meta name="description" content="js">\'</script><meta name="description" content="real">',
    'real',
  ],
  [
    '<title><meta name="description" content="in title"></title><meta name="description" content="real">',
    'real',
  ],
  [
    '<a title=\'<meta name="description" content="attr">\'></a><meta name="description" content="real">',
    'real',
  ],
  ['<meta name="description" content="first" content="second">', 'first'],
])(
  'Given %j, When the description is read, Then it is %j',
  (html, expected) => {
    expect(descriptionOf(html)).toBe(expected)
  },
)

test.each([
  ['no meta', '<title>Talk</title><h1>Slides</h1>'],
  ['a description without content', '<meta name="description">'],
  ['a blank description', '<meta name="description" content=" &nbsp; ">'],
  [
    'only an Open Graph description',
    '<meta property="og:description" content="x">',
  ],
  ['a longer name', '<meta name="description-x" content="x">'],
  ['a meta-like custom element', '<meta-x name="description" content="x">'],
  ['an unclosed meta', '<meta name="description" content="x"'],
  [
    'a meta only inside an unclosed comment',
    '<!-- <meta name="description" content="x">',
  ],
  ['empty input', ''],
])('Given %s, When the description is read, Then there is none', (_, html) => {
  expect(descriptionOf(html)).toBeNull()
})

test('Given a description longer than the limit, When it is read, Then it is cut at the limit without splitting a surrogate pair', () => {
  const description = descriptionOf(
    `<meta name="description" content="${'😀'.repeat(DESCRIPTION_MAX_LENGTH + 5)}">`,
  )

  expect(description).toBe('😀'.repeat(DESCRIPTION_MAX_LENGTH))
})

test('Given markup inside the description, When it is read, Then it stays as text', () => {
  expect(
    descriptionOf(
      '<meta name="description" content="&lt;script&gt;alert(1)&lt;/script&gt;">',
    ),
  ).toBe('<script>alert(1)</script>')
})

const scanned = (unit: string) =>
  unit
    .repeat(Math.ceil(TITLE_SCAN_BYTES / unit.length))
    .slice(0, TITLE_SCAN_BYTES)

test.each([
  ['open metas', '<meta'],
  ['metas with an unclosed quote', '<meta content="'],
  ['metas without an end', '<meta a '],
  ['attributes without a value', '<meta a= '],
  ['comments without an end', '<!--'],
  ['raw text without an end', '<script>'],
])(
  'Given a scan full of %s, When the description is read, Then it answers quickly',
  (_, unit) => {
    const started = performance.now()

    descriptionOf(scanned(unit))

    expect(performance.now() - started).toBeLessThan(1000)
  },
)

test.each([
  ['an empty comment', '<!-->'],
  ['an empty comment with a dash', '<!--->'],
])(
  'Given %s before the description, When it is read, Then the comment ends where a browser ends it',
  (_, comment) => {
    expect(
      descriptionOf(`${comment}<meta name="description" content="Shown">`),
    ).toBe('Shown')
  },
)

test.each(['noscript', 'xmp', 'iframe', 'noembed', 'noframes'])(
  'Given a description only inside <%s>, When it is read, Then there is none',
  (element) => {
    expect(
      descriptionOf(
        `<${element}><meta name="description" content="Hidden"></${element}>`,
      ),
    ).toBeNull()
  },
)

test.each([
  ['a zero-width space', '&#x200B;'],
  ['a byte order mark and spaces', ' &#xFEFF; '],
])(
  'Given a description of only %s, When it is read, Then there is none',
  (_, content) => {
    expect(
      descriptionOf(`<meta name="description" content="${content}">`),
    ).toBeNull()
  },
)

test.each([
  [
    'a reference without a semicolon before =',
    'https://example.com/?a=1&copy=2026',
    'https://example.com/?a=1&copy=2026',
  ],
  ['a reference with a semicolon', '&copy; 2026', '© 2026'],
  ['an escaped ampersand', '&amp;copy=2026', '&copy=2026'],
])(
  'Given %s in the content attribute, When it is read, Then it reads as a browser reads an attribute',
  (_, content, expected) => {
    expect(
      descriptionOf(`<meta name="description" content="${content}">`),
    ).toBe(expected)
  },
)

const NESTED = `<template><template></template>
  <meta name="description" content="Hidden"></template>`

test('Given a description inside nested templates, When it is read, Then the document’s own after them is taken', () => {
  expect(
    descriptionOf(`${NESTED}<meta name="description" content="Real">`),
  ).toBe('Real')
})

test('Given a description only inside nested templates, When it is read, Then there is none', () => {
  expect(descriptionOf(NESTED)).toBeNull()
})

test('Given a stray template end tag, When the description after it is read, Then it is taken', () => {
  expect(
    descriptionOf('</template><meta name="description" content="Real">'),
  ).toBe('Real')
})
