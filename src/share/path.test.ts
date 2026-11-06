import { expect, test } from 'vitest'
import { isSharePath, parseSharePath, sharePath } from './path'

test('Given a canonical share path, When parsed, Then it names the handle and deck', () => {
  expect(parseSharePath('/@kfly8/good-slide')).toEqual({
    kind: 'deck',
    handle: 'kfly8',
    slug: 'good-slide',
  })
})

test.each([
  '/@KFly8/good-slide',
  '/@kfly8/Good-Slide',
  '/@kfly8/good-slide/',
  '/%40kfly8/good-slide',
  '/@kfly8/good-sl%69de',
])(
  'Given %s, When parsed, Then it redirects to the canonical spelling',
  (path) => {
    expect(parseSharePath(path)).toEqual({
      kind: 'redirect',
      path: '/@kfly8/good-slide',
    })
  },
)

test.each([
  '/kfly8/talk',
  '/@',
  '/@kfly8',
  '/@kfly8/',
  '/@kfly8/talk/extra',
  '/@kfly8/talk//',
  '/@/talk',
  '/@-kfly8/talk',
  '/@k_fly8/talk',
  `/@${'a'.repeat(40)}/talk`,
  '/@kfly8/-talk',
  '/@kfly8/talk.html',
  '/@kfly8/%2e%2e',
  '/@kfly8%2Ftalk/x',
  '/@kfly8/%E0%A4',
])('Given %j, When parsed, Then it is invalid', (path) => {
  expect(parseSharePath(path)).toEqual({ kind: 'invalid' })
})

test.each([
  ['/@kfly8/talk', true],
  ['/%40kfly8/talk', true],
  ['/%40', true],
  ['/decks', false],
  ['/', false],
])(
  'Given %s, When checked, Then it is under share URLs: %s',
  (path, expected) => {
    expect(isSharePath(path)).toBe(expected)
  },
)

test('Given a handle and deck, When the path is built, Then it parses back to them', () => {
  const parsed = parseSharePath('/@kfly8/talk')
  if (parsed.kind !== 'deck') throw new Error('expected a deck')
  expect(sharePath(parsed.handle, parsed.slug)).toBe('/@kfly8/talk')
})
