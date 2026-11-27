import { expect, test } from 'vitest'
import { RECENT_DECKS_SHOWN } from '../share/list-pages'
import { handleSchema } from '../share/handle'
import type { PublicDeck } from '../share/store'
import { toHomeLists } from './home-lists'
import { HOME_RECENT_SHOWN } from './home-shape'
import { markViewer, MEMBER, NOT_MEMBER } from './home-viewer'

const base = new URL('https://content.example')
const followed = (slug: string): PublicDeck => ({
  handle: handleSchema.parse('bob'),
  slug: slug as PublicDeck['slug'],
  title: null,
  readyAt: 100,
  deploymentId: `d-${slug}`,
  coverPath: null,
})

test('Given five slides of followed people read, When the list is made, Then all five come in their order as the recent slides show theirs', () => {
  const { following } = toHomeLists(
    ['a', 'b', 'c', 'd', 'e'].map(followed),
    base,
  )
  expect(following.map((deck) => deck.name)).toEqual(['a', 'b', 'c', 'd', 'e'])
  expect(following[0]).toEqual({
    name: 'a',
    href: '/@bob/a',
    handle: 'bob',
    slug: 'a',
    authorHref: '/@bob',
    authorAvatarUrl: null,
    publishedAt: '1970-01-01T00:01:40.000Z',
    coverUrl: '/covers/d-a.jpg',
    citedBy: 0,
  })
})

test('Given the picture address of an author, When the list is made, Then their cards carry it, and an author without one carries none', () => {
  const faces = new Map([['bob', '/avatars/u1?v=g']])
  const { following } = toHomeLists(
    [followed('a'), { ...followed('b'), handle: handleSchema.parse('amy') }],
    base,
    new Map(),
    faces,
  )
  expect(following.map((deck) => deck.authorAvatarUrl)).toEqual([
    '/avatars/u1?v=g',
    null,
  ])
})

test('F21-AC52: Given nobody followed, or no content origin, When the list is made, Then it is empty, or comes without covers', () => {
  expect(toHomeLists([], base)).toEqual({ following: [] })
  expect(toHomeLists([followed('a')], null).following[0]?.coverUrl).toBeNull()
})

test('F03-AC83: Given the room the top page holds for recent slides, When it is compared with what the server lists, Then they are the same number', () => {
  expect(HOME_RECENT_SHOWN).toBe(RECENT_DECKS_SHOWN)
})

const page = `<div class="page home" ${NOT_MEMBER}><p>${NOT_MEMBER}</p></div>`

test('Given a visitor with no session cookie, When the page is marked, Then it stays as built', () => {
  expect(markViewer(page, { kind: 'visitor' })).toBe(page)
})

test('Given a visitor with a session cookie, When the page is marked, Then only the page’s own member mark changes, and nothing inside it', () => {
  expect(markViewer(page, { kind: 'member' })).toBe(
    `<div class="page home" ${MEMBER}><p>${NOT_MEMBER}</p></div>`,
  )
})

test('Given a page without the mark, When it is marked, Then it comes back as it was', () => {
  const bare = '<div class="page home"></div>'
  expect(markViewer(bare, { kind: 'member' })).toBe(bare)
})
