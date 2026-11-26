import { expect, test } from 'vitest'
import type { DeckSlug } from '../decks/deck-id'
import type { Handle } from './handle'
import {
  communitiesPath,
  isSharePath,
  ownerViewerPath,
  parseSharePath,
  returnToShare,
  sharePath,
} from './path'

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

test('Given a canonical page path, When parsed, Then it names the page', () => {
  expect(parseSharePath('/@kfly8/good-slide/6')).toEqual({
    kind: 'page',
    handle: 'kfly8',
    slug: 'good-slide',
    page: 6,
  })
})

test.each([
  '/@kfly8/Good-Slide/6',
  '/@kfly8/good-slide/06',
  '/@kfly8/good-slide/6/',
])(
  'Given %s, When parsed, Then it redirects to the canonical page path',
  (path) => {
    expect(parseSharePath(path)).toEqual({
      kind: 'redirect',
      path: '/@kfly8/good-slide/6',
    })
  },
)

test.each([
  '/@kfly8/talk/0',
  '/@kfly8/talk/-1',
  '/@kfly8/talk/1.5',
  '/@kfly8/talk/10000',
  '/@kfly8/talk/6/7',
  '/@kfly8/talk/%36x',
  '/kfly8/talk',
  '/@',
  '/@/',
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
  ['/my/slides', false],
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
  expect(sharePath(parsed.handle, parsed.slug, 6)).toBe('/@kfly8/talk/6')
})

test.each([
  ['/@owner', '/@owner'],
  ['/@owner/talk', '/@owner/talk'],
  ['/@owner/talk/3', '/@owner/talk/3'],
  ['//host', '/my/slides'],
  ['https://host/@owner', '/my/slides'],
  ['/\\host/@owner', '/my/slides'],
  ['/@owner\\talk', '/my/slides'],
  ['/%40owner', '/my/slides'],
  ['/@owner?next=/settings', '/my/slides'],
  ['/@owner/talk/3?lang=en', '/my/slides'],
  ['/@owner/talk/03', '/my/slides'],
  ['/@owner/', '/my/slides'],
  ['settings', '/my/slides'],
  [undefined, '/my/slides'],
  [['/@owner'], '/my/slides'],
])(
  'F21-AC1: Given return destination %j, When validated, Then the reader returns to %s',
  (input, expected) => {
    expect(returnToShare(input)).toBe(expected)
  },
)

test('F02-AC31 and F02-AC41: Given a version, When the author’s link to the viewer is made, Then it names the version in the query only', () => {
  const handle = 'owner' as Handle
  const slug = 'talk' as DeckSlug
  expect(ownerViewerPath(handle, slug, null)).toBe('/@owner/talk')
  expect(ownerViewerPath(handle, slug, 'a-b')).toBe('/@owner/talk?v=a-b')
})

test("F21-AC65: Given /@kfly8/communities, When parsed, Then it names the profile's list of communities, not a deck", () => {
  expect(parseSharePath('/@kfly8/communities')).toEqual({
    kind: 'communities',
    handle: 'kfly8',
  })
  expect(communitiesPath('kfly8' as Handle)).toBe('/@kfly8/communities')
})

test.each([
  '/@kfly8/Communities',
  '/@kfly8/communities/',
  '/@KFly8/communities',
  '/%40kfly8/communities',
])(
  'F21-AC65: Given %s, When parsed, Then it redirects to the list of communities',
  (path) => {
    expect(parseSharePath(path)).toEqual({
      kind: 'redirect',
      path: '/@kfly8/communities',
    })
  },
)

test.each(['/@kfly8/communities/2', '/@kfly8/communities/x'])(
  'F21-AC65: Given %s, When parsed, Then it is invalid: the list has no pages by path',
  (path) => {
    expect(parseSharePath(path)).toEqual({ kind: 'invalid' })
  },
)

test('F21-AC65: Given a sign-in that started on a list of communities, When the destination is validated, Then the reader returns to that list', () => {
  expect(returnToShare('/@owner/communities')).toBe('/@owner/communities')
  expect(returnToShare('/@owner/communities?x=1')).toBe('/my/slides')
})
