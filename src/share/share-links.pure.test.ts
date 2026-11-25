import { expect, test } from 'vitest'
import { postPrefixes, postUrl } from './share-links'

const SHARE = 'https://slide.example/@owner/talk/3'

test('F03-AC16: Given a title and the URL of a page, When the post links are built, Then X gets the title and the URL apart and Bluesky gets them as one text', () => {
  const prefixes = postPrefixes('Good slides')
  const x = new URL(postUrl(prefixes.x, SHARE))
  expect(x.origin + x.pathname).toBe('https://x.com/intent/post')
  expect(Object.fromEntries(x.searchParams)).toEqual({
    text: 'Good slides',
    url: SHARE,
  })
  const bluesky = new URL(postUrl(prefixes.bluesky, SHARE))
  expect(bluesky.origin + bluesky.pathname).toBe(
    'https://bsky.app/intent/compose',
  )
  expect(Object.fromEntries(bluesky.searchParams)).toEqual({
    text: `Good slides ${SHARE}`,
  })
})

test.each([
  ['quotes and markup', `"><script>alert('1')</script>`],
  ['separators of a query', 'a&url=https://evil.example#x?y=1'],
  ['a plus sign and spaces', '1 + 1 = 2'],
  ['a percent sign that is no escape', '100% %zz'],
  ['an emoji and Japanese', 'スライド 🎉'],
  ['a lone surrogate', 'broken \ud83c title'],
  ['nothing', ''],
])(
  'F03-AC16: Given a title with %s, When the post links are built, Then the title is read back whole and the URL stays the one given',
  (_, title) => {
    const prefixes = postPrefixes(title)
    // What a browser would read back; a lone surrogate has no spelling.
    const read = title.toWellFormed()
    const x = new URL(postUrl(prefixes.x, SHARE))
    expect([...x.searchParams.keys()]).toEqual(['text', 'url'])
    expect(x.searchParams.get('text')).toBe(read)
    expect(x.searchParams.get('url')).toBe(SHARE)
    expect(x.hash).toBe('')
    const bluesky = new URL(postUrl(prefixes.bluesky, SHARE))
    expect([...bluesky.searchParams.keys()]).toEqual(['text'])
    expect(bluesky.searchParams.get('text')).toBe(`${read} ${SHARE}`)
    // Neither address holds a character that could end an attribute.
    for (const prefix of Object.values(prefixes))
      expect(prefix).not.toMatch(/["'<> +]/)
  },
)

test('F03-AC16: Given the same prefix, When the viewer’s script appends a URL with encodeURIComponent, Then the address equals the one built on the server', () => {
  const prefixes = postPrefixes('Good slides')
  for (const prefix of Object.values(prefixes))
    expect(prefix + encodeURIComponent(SHARE)).toBe(postUrl(prefix, SHARE))
})
