import { expect, test } from 'vitest'
import { parseSharePath, sharePath } from './path'

test('Given a canonical share path, When parsed, Then it names the handle and deck', () => {
  expect(parseSharePath('@kfly8', 'good-slide')).toEqual({
    kind: 'deck',
    handle: 'kfly8',
    slug: 'good-slide',
  })
})

test.each([
  ['@KFly8', 'good-slide', '/@kfly8/good-slide'],
  ['@kfly8', 'Good-Slide', '/@kfly8/good-slide'],
])(
  'Given %s/%s, When parsed, Then it redirects to the lowercase spelling',
  (handle, slug, path) => {
    expect(parseSharePath(handle, slug)).toEqual({ kind: 'redirect', path })
  },
)

test.each([
  ['kfly8', 'talk'],
  ['@', 'talk'],
  ['@-kfly8', 'talk'],
  ['@k_fly8', 'talk'],
  ['@' + 'a'.repeat(40), 'talk'],
  ['@kfly8', ''],
  ['@kfly8', '-talk'],
  ['@kfly8', 'talk.html'],
  ['@kfly8', '%2e%2e'],
])('Given %j/%j, When parsed, Then it is invalid', (handle, slug) => {
  expect(parseSharePath(handle, slug)).toEqual({ kind: 'invalid' })
})

test('Given a handle and deck, When the path is built, Then it parses back to them', () => {
  const parsed = parseSharePath('@kfly8', 'talk')
  if (parsed.kind !== 'deck') throw new Error('expected a deck')
  expect(sharePath(parsed.handle, parsed.slug)).toBe('/@kfly8/talk')
})
