import { expect, test } from 'vitest'
import type { FollowedCommunityTalk } from '../communities/feed-store'
import { handleSchema } from '../share/handle'
import { deckSlugSchema } from '../decks/deck-id'
import { toHomeCommunities } from './home-communities'
import { FOLLOWED_COMMUNITY_TALKS_PATH } from './home-shape'

const talk = (n: number): FollowedCommunityTalk => ({
  handle: handleSchema.parse('alice'),
  slug: deckSlugSchema.parse(`talk-${n}`),
  title: n === 1 ? null : `<b>Talk ${n}</b>`,
  readyAt: 1_700_000_000 + n,
  deploymentId: `7ae11c67-633f-4f21-b2b1-80af8410742${n}`,
  coverPath: n === 2 ? 'cover.png' : null,
  community: {
    handle: handleSchema.parse('kanagawapm'),
    name: 'Kanagawa.pm 🐪',
    color: 'navy',
  },
})

test('F31-AC3: Given more slides than the top page shows, When they are made ready, Then the first eight stay in their order', () => {
  const lists = toHomeCommunities(
    Array.from({ length: 10 }, (_, i) => talk(i + 1)),
    null,
  )
  expect(lists.talks.map((deck) => deck.href)).toEqual(
    Array.from({ length: 8 }, (_, i) => `/@alice/talk-${i + 1}`),
  )
})

test('F31-AC4: Given slides with and without a title and a cover, When they are made ready, Then each carries its community, its name falls back to the slug, and its citations count', () => {
  const [first, second] = toHomeCommunities(
    [talk(1), talk(2)],
    new URL('https://content.example/'),
    new Map([['alice/talk-2', 3]]),
  ).talks
  expect(first).toMatchObject({
    name: 'talk-1',
    citedBy: 0,
    community: { name: 'Kanagawa.pm 🐪', href: '/@kanagawapm', color: 'navy' },
  })
  expect(second?.name).toBe('<b>Talk 2</b>')
  expect(second?.citedBy).toBe(3)
  expect(second?.coverUrl).not.toBeNull()
})

test('F31-AC6: Given no slide, When they are made ready, Then the list is empty', () => {
  expect(toHomeCommunities([], null)).toEqual({ talks: [] })
})

test('F31-AC5: Given the whole list, When its path is read, Then it is the page the route serves', () => {
  expect(FOLLOWED_COMMUNITY_TALKS_PATH).toBe('/communities/following')
})
