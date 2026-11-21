import { expect, test } from 'vitest'
import { RECENT_DECKS_SHOWN } from '../share/list-pages'
import { handleSchema } from '../share/handle'
import type { PublicDeck } from '../share/store'
import { toHomeLists } from './home-lists'
import { HOME_FOLLOWING_SHOWN, HOME_RECENT_SHOWN } from './home-shape'
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
  })
})

test('F21-AC43: Given nobody followed, or no content origin, When the list is made, Then it is empty, or comes without covers', () => {
  expect(toHomeLists([], base)).toEqual({ following: [] })
  expect(toHomeLists([followed('a')], null).following[0]?.coverUrl).toBeNull()
})

test('F03-AC83: Given the room the top page holds for recent slides, When it is compared with what the server lists, Then they are the same number', () => {
  expect(HOME_RECENT_SHOWN).toBe(RECENT_DECKS_SHOWN)
})

const page = `<div class="page home" ${NOT_MEMBER}><p>${NOT_MEMBER}</p></div>`

test('F21-AC44: Given a visitor with no session cookie, When the page is marked, Then it stays as built', () => {
  expect(markViewer(page, false)).toBe(page)
})

test('F21-AC43: Given a visitor with a session cookie, When the page is marked, Then only the page’s own mark changes', () => {
  expect(markViewer(page, true)).toBe(
    `<div class="page home" ${MEMBER}><p>${NOT_MEMBER}</p></div>`,
  )
})
