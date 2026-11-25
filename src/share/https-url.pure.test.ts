import { expect, test } from 'vitest'
import { parseHttpsUrl } from './https-url'

test.each([
  ['https://example.com', 'https://example.com/'],
  ['  https://example.com/a?b=1#c  ', 'https://example.com/a?b=1#c'],
])('Given %j, When it is parsed, Then it is kept as %s', (typed, kept) => {
  expect(parseHttpsUrl(typed, 100)).toEqual({ ok: true, url: kept })
})

test.each([
  ['', 'invalid'],
  ['   ', 'invalid'],
  ['not a url', 'invalid'],
  ['https://exa\tmple.com', 'invalid'],
  ['http://example.com', 'not_https'],
  ['javascript:alert(1)', 'not_https'],
  ['https://user:pw@example.com', 'credentials'],
  ['https://user@example.com', 'credentials'],
  ['https://example.com/' + 'a'.repeat(100), 'too_long'],
])('Given %j, When it is parsed, Then it is refused as %s', (typed, reason) => {
  expect(parseHttpsUrl(typed, 100)).toEqual({ ok: false, reason })
})

test('Given an address exactly at the limit, When it is parsed, Then it is kept, and one more character is refused', () => {
  const at = 'https://e.co/' + 'a'.repeat(100 - 'https://e.co/'.length)
  expect(parseHttpsUrl(at, 100).ok).toBe(true)
  expect(parseHttpsUrl(at + 'a', 100)).toEqual({
    ok: false,
    reason: 'too_long',
  })
})
