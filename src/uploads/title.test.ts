import { expect, test } from 'vitest'
import { TITLE_MAX_LENGTH, TITLE_SCAN_BYTES, titleOf } from './title'

test.each([
  ['<title>Good talk</title>', 'Good talk'],
  ['<html><head><TITLE lang="ja">発表</TITLE></head>', '発表'],
  ['<title>\n  Line\n\tbreaks  </title>', 'Line breaks'],
  ['<title>A &amp; B &lt;3 &#x1F600; &#39;q&#39;</title>', "A & B <3 😀 'q'"],
  ['<title>first</title><title>second</title>', 'first'],
  ['<title>&unknown;</title>', '&unknown;'],
  ['<title>Caf&eacute; &rarr; Z&uuml;rich</title>', 'Café → Zürich'],
  ['<meta content="<title>Fake</title>"><title>Real</title>', 'Real'],
  ["<meta content='<title>Fake</title>'><title>Real</title>", 'Real'],
  ['<title data-x=">">Real</title>', 'Real'],
  ['<title>A &mdash; B &hellip; &copy;</title>', 'A — B … ©'],
  ['<!-- <title>old</title> --><title>new</title>', 'new'],
  ['<script>x="<title>js</title>"</script><title>real</title>', 'real'],
  ['<title-x>custom</title-x><title>real</title>', 'real'],
])('Given %j, When the title is read, Then it is %j', (html, expected) => {
  expect(titleOf(html)).toBe(expected)
})

test.each([
  ['no title', '<h1>Slides</h1>'],
  ['an empty title', '<title></title>'],
  ['a blank title', '<title> \n &nbsp; </title>'],
  ['an unclosed title', '<title>never closed'],
  ['a title only inside an unclosed comment', '<!-- <title>x</title>'],
  ['empty input', ''],
])('Given %s, When the title is read, Then there is none', (_, html) => {
  expect(titleOf(html)).toBeNull()
})

test('Given a title longer than the limit, When it is read, Then it is cut at the limit without splitting a character', () => {
  const title = titleOf(`<title>${'😀'.repeat(TITLE_MAX_LENGTH + 5)}</title>`)
  expect(Array.from(title ?? '')).toHaveLength(TITLE_MAX_LENGTH)
  expect(title).toBe('😀'.repeat(TITLE_MAX_LENGTH))
})

test('Given markup inside the title, When it is read, Then it stays as text', () => {
  expect(titleOf('<title><script>alert(1)</script></title>')).toBe(
    '<script>alert(1)</script>',
  )
})

const scanned = (unit: string) =>
  unit
    .repeat(Math.ceil(TITLE_SCAN_BYTES / unit.length))
    .slice(0, TITLE_SCAN_BYTES)

test.each([
  ['open tags', '<a'],
  ['tags with an unclosed quote', '<a x="'],
  ['tags without an end', '<a b '],
  ['quoted attributes without an end', '<a x="y" '],
  ['raw text without an end', '<script>'],
  ['comments without an end', '<!--'],
  ['titles without an end', '<title>'],
  ['titles with unclosed attributes', '<title x="'],
])(
  'Given %s filling the scanned bytes, When the title is read, Then it finishes quickly',
  (_, unit) => {
    const started = performance.now()
    titleOf(scanned(unit))
    expect(performance.now() - started).toBeLessThan(500)
  },
)
