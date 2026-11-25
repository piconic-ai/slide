import { expect, test } from 'vitest'
import { RECENT_DECKS_SHOWN } from '../share/list-pages'
import { handleSchema } from '../share/handle'
import type { PublicDeck } from '../share/store'
import { toHomeLists } from './home-lists'
import { HOME_FOLLOWING_SHOWN, HOME_RECENT_SHOWN } from './home-shape'
import {
  COMMUNITIES,
  markViewer,
  MEMBER,
  NO_COMMUNITIES,
  NOT_MEMBER,
} from './home-viewer'

const base = new URL('https://content.example')
const followed = (slug: string): PublicDeck => ({
  handle: handleSchema.parse('bob'),
  slug: slug as PublicDeck['slug'],
  title: null,
  readyAt: 100,
  deploymentId: `d-${slug}`,
  coverPath: null,
})

test('F21-AC16: Given five slides of followed people, When the list is made, Then the first four come as the recent slides show theirs', () => {
  const { following } = toHomeLists(
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
    citedBy: 0,
  })
})

test('F21-AC52: Given nobody followed, or no content origin, When the list is made, Then it is empty, or comes without covers', () => {
  expect(toHomeLists([], base)).toEqual({ following: [] })
  expect(toHomeLists([followed('a')], null).following[0]?.coverUrl).toBeNull()
})

test('F03-AC83: Given the room the top page holds for recent slides, When it is compared with what the server lists, Then they are the same number', () => {
  expect(HOME_RECENT_SHOWN).toBe(RECENT_DECKS_SHOWN)
})

const page = `<div class="page home" ${NOT_MEMBER} ${NO_COMMUNITIES}><p>${NOT_MEMBER} ${NO_COMMUNITIES}</p></div>`

test('F21-AC53: Given a visitor with no session cookie, When the page is marked, Then it stays as built', () => {
  expect(markViewer(page, { kind: 'visitor' })).toBe(page)
})

test('F21-AC52, F31-AC6: Given a visitor with a session cookie who follows no community, When the page is marked, Then only the page’s own member mark changes', () => {
  expect(markViewer(page, { kind: 'member', followsCommunity: false })).toBe(
    `<div class="page home" ${MEMBER} ${NO_COMMUNITIES}><p>${NOT_MEMBER} ${NO_COMMUNITIES}</p></div>`,
  )
})

test('F31-AC16: Given a visitor whose session follows a community, When the page is marked, Then both of the page’s own marks change, and nothing inside it', () => {
  expect(markViewer(page, { kind: 'member', followsCommunity: true })).toBe(
    `<div class="page home" ${MEMBER} ${COMMUNITIES}><p>${NOT_MEMBER} ${NO_COMMUNITIES}</p></div>`,
  )
})

test('F31-AC16: Given a page without the marks, When it is marked, Then it comes back as it was', () => {
  const bare = '<div class="page home"></div>'
  expect(markViewer(bare, { kind: 'member', followsCommunity: true })).toBe(
    bare,
  )
})
