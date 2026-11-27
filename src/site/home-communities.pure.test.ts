import { expect, test } from 'vitest'
import type { FollowedCommunityTalk } from '../communities/feed-store'
import { handleSchema } from '../share/handle'
import { deckSlugSchema } from '../decks/deck-id'
import { toHomeCommunities } from './home-communities'

const talk = (n: number): FollowedCommunityTalk => ({
  handle: handleSchema.parse('alice'),
  slug: deckSlugSchema.parse(`talk-${n}`),
  title: n === 1 ? null : `<b>Talk ${n}</b>`,
  readyAt: 1_700_000_000 + n,
  deploymentId: `7ae11c67-633f-4f21-b2b1-80af8410742${n}`,
  coverPath: n === 2 ? 'cover.png' : null,
  authorAvatarUrl: '/avatars/u1?v=g',
  community: {
    handle: handleSchema.parse('kanagawapm'),
    name: 'Kanagawa.pm 🐪',
    color: 'navy',
  },
})

test('Given ten slides read, When they are made ready, Then all ten stay in their order (the route reads as many as the list asks for)', () => {
  const lists = toHomeCommunities(
    Array.from({ length: 10 }, (_, i) => talk(i + 1)),
    null,
  )
  expect(lists.talks.map((deck) => deck.href)).toEqual(
    Array.from({ length: 10 }, (_, i) => `/@alice/talk-${i + 1}`),
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
