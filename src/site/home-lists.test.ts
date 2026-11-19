import { expect, test } from 'vitest'
import type { OwnDeck } from '../decks/own-decks'
import { handleSchema } from '../share/handle'
import type { PublicDeck } from '../share/store'
import { toHomeLists } from './home-lists'
import {
  HOME_FOLLOWING_SHOWN,
  HOME_OWN_SHOWN,
  homeShapeOf,
  keptHomeShape,
} from './home-shape'

const base = new URL('https://content.example')
const own = (slug: string, rest: Partial<OwnDeck> = {}): OwnDeck => ({
  slug,
  isPublic: false,
  shown: {
    deploymentId: `d-${slug}`,
    title: `Title of ${slug}`,
    coverPath: null,
  },
  updatedAt: 1,
  ...rest,
})
const followed = (slug: string): PublicDeck => ({
  handle: handleSchema.parse('bob'),
  slug: slug as PublicDeck['slug'],
  title: null,
  readyAt: 100,
  deploymentId: `d-${slug}`,
  coverPath: null,
})

test('F21-AC15: Given six of the visitor’s slides, public and not, When the lists are made, Then the first four come in the order given, each with its own page and whether readers can open it', () => {
  const decks = [
    own('a', { isPublic: true }),
    own('b'),
    own('c', { shown: null }),
    own('d', { isPublic: true }),
    own('e'),
    own('f'),
  ]
  const { own: shown } = toHomeLists(decks, [], base)
  expect(shown).toHaveLength(HOME_OWN_SHOWN)
  expect(shown.map(({ href, isPublic }) => [href, isPublic])).toEqual([
    ['/slides/a', true],
    ['/slides/b', false],
    ['/slides/c', false],
    ['/slides/d', true],
  ])
  expect(shown[0]).toEqual({
    name: 'Title of a',
    href: '/slides/a',
    coverUrl: '/covers/d-a.jpg',
    isPublic: true,
  })
  // A slide still receiving its first version has no cover and no title.
  expect(shown[2]).toEqual({
    name: 'c',
    href: '/slides/c',
    coverUrl: null,
    isPublic: false,
  })
})

test('F21-AC16: Given five slides of followed people, When the lists are made, Then the first four come as the recent slides show theirs', () => {
  const { following } = toHomeLists(
    [],
    ['a', 'b', 'c', 'd', 'e'].map(followed),
    base,
  )
  expect(following).toHaveLength(HOME_FOLLOWING_SHOWN)
  expect(following[0]).toEqual({
    name: 'a',
    href: '/@bob/a',
    handle: 'bob',
    authorHref: '/@bob',
    publishedAt: '1970-01-01T00:01:40.000Z',
    coverUrl: '/covers/d-a.jpg',
  })
})

test('F21-AC17: Given no slides and nobody followed, or no content origin, When the lists are made, Then both are empty, or come without covers', () => {
  expect(toHomeLists([], [], base)).toEqual({ own: [], following: [] })
  const bare = toHomeLists([own('a')], [followed('a')], null)
  expect(bare.own[0]?.coverUrl).toBeNull()
  expect(bare.following[0]?.coverUrl).toBeNull()
})

const signedIn = JSON.stringify({ signedIn: true, login: 'kfly8' })

test('F21-AC18: Given this browser last saw the visitor signed in with two slides and three new ones, When the lists are on their way, Then that shape is held', () => {
  expect(
    keptHomeShape(signedIn, JSON.stringify({ own: 2, following: 3 })),
  ).toEqual({ own: 2, following: 3 })
})

test.each([
  ['nothing kept', null, null],
  ['no session kept', null, '{"own":2,"following":3}'],
  ['a session that ended', '{"signedIn":false}', '{"own":2,"following":3}'],
  [
    'a session that only looks true',
    '{"signedIn":"true"}',
    '{"own":2,"following":3}',
  ],
  ['no shape kept', signedIn, null],
  ['a shape that is not JSON', signedIn, '{own:2'],
  ['a session that is not JSON', '<html>', '{"own":2,"following":3}'],
  ['a shape that is a list', signedIn, '[2,3]'],
  ['a shape that is a number', signedIn, '4'],
  ['counts that are not numbers', signedIn, '{"own":"2","following":null}'],
  ['counts below one', signedIn, '{"own":0,"following":-3}'],
  ['counts that are not whole', signedIn, '{"own":1.5,"following":"NaN"}'],
])(
  'F21-AC18: Given %s, When the lists are on their way, Then no placeholder is held',
  (_, session, shape) => {
    expect(keptHomeShape(session, shape)).toEqual({ own: 0, following: 0 })
  },
)

test('F21-AC18: Given a kept shape larger than the lists can be, When it is read, Then it is cut to what the page shows', () => {
  expect(
    keptHomeShape(signedIn, JSON.stringify({ own: 1e9, following: 5 })),
  ).toEqual({ own: HOME_OWN_SHOWN, following: HOME_FOLLOWING_SHOWN })
})

test('F21-AC17: Given the answer that came, When its shape is kept, Then it counts each list, and nothing for a visitor who is not signed in', () => {
  expect(homeShapeOf(null)).toEqual({ own: 0, following: 0 })
  expect(
    homeShapeOf(toHomeLists([own('a'), own('b')], [followed('x')], base)),
  ).toEqual({ own: 2, following: 1 })
})
