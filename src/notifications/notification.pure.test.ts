import { expect, test } from 'vitest'
import { DELIVERED_KINDS, notificationSchema } from './notification'

const base = {
  id: 'n1',
  at: 10,
  readAt: null,
  actorHandle: 'alice',
  deckSlug: 'talk',
  deckTitle: 'Talk',
  targetSlug: null,
  targetTitle: null,
  communityHandle: null,
  communityName: null,
}
const community = {
  communityHandle: 'kanagawapm',
  communityName: 'Kanagawa.pm',
}

test('Given a community_published row with its community, When it is parsed, Then the output names the community and the slide', () => {
  expect(
    notificationSchema.parse({
      ...base,
      kind: 'community_published',
      ...community,
    }),
  ).toEqual({
    id: 'n1',
    at: 10,
    unread: true,
    actor: { handle: 'alice' },
    kind: 'community_published',
    deck: { handle: 'alice', slug: 'talk', title: 'Talk' },
    community: { handle: 'kanagawapm', name: 'Kanagawa.pm' },
  })
})

test('Given a community_published row, When the community is missing or the row cites a slide, Then it is rejected', () => {
  expect(
    notificationSchema.safeParse({ ...base, kind: 'community_published' })
      .success,
  ).toBe(false)
  expect(
    notificationSchema.safeParse({
      ...base,
      kind: 'community_published',
      ...community,
      targetSlug: 'other',
    }).success,
  ).toBe(false)
})

test.each(['cited', 'followee_published', 'followed'])(
  'Given a %s row, When it carries a community, Then it is rejected',
  (kind) => {
    const row = {
      ...base,
      kind,
      ...community,
      ...(kind === 'cited'
        ? { targetSlug: 'other', targetTitle: 'Other' }
        : {}),
      ...(kind === 'followed' ? { deckSlug: null, deckTitle: null } : {}),
    }
    expect(notificationSchema.safeParse(row).success).toBe(false)
  },
)

test('Given the delivered kinds, When they are listed, Then community_published is one of them', () => {
  expect(DELIVERED_KINDS).toContain('community_published')
})
