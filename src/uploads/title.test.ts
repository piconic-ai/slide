import { expect, test } from 'vitest'
import { TITLE_MAX_LENGTH, titleOf } from './title'

test.each([
  ['<title>Good talk</title>', 'Good talk'],
  ['<html><head><TITLE lang="ja">発表</TITLE></head>', '発表'],
  ['<title>\n  Line\n\tbreaks  </title>', 'Line breaks'],
  ['<title>A &amp; B &lt;3 &#x1F600; &#39;q&#39;</title>', "A & B <3 😀 'q'"],
  ['<title>first</title><title>second</title>', 'first'],
  ['<title>&unknown; &#0;</title>', '&unknown; &#0;'],
])('Given %j, When the title is read, Then it is %j', (html, expected) => {
  expect(titleOf(html)).toBe(expected)
})

test.each([
  ['no title', '<h1>Slides</h1>'],
  ['an empty title', '<title></title>'],
  ['a blank title', '<title> \n &nbsp; </title>'],
  ['an unclosed title', '<title>never closed'],
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
