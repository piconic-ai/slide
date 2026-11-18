import { z } from 'zod'
import { deckSlugSchema } from '../decks/binding'
import { handleSchema } from '../share/handle'

export const NOTIFICATION_KINDS = [
  'cited',
  'github_followee_joined',
  'followee_published',
  'followed',
] as const
export const notificationKindSchema = z.enum(NOTIFICATION_KINDS)
export type NotificationKind = z.infer<typeof notificationKindSchema>
export const DELIVERED_KINDS = [
  'cited',
  'github_followee_joined',
  'followee_published',
  'followed',
] as const satisfies readonly NotificationKind[]

const common = z.object({
  id: z.string(),
  at: z.number().int(),
  readAt: z.number().int().nullable(),
  actorHandle: handleSchema,
})
const published = common.extend({
  kind: z.literal('followee_published'),
  deckSlug: deckSlugSchema,
  deckTitle: z.string().nullable(),
  targetSlug: z.null(),
  targetTitle: z.null(),
})
const cited = published.extend({
  kind: z.literal('cited'),
  targetSlug: deckSlugSchema,
  targetTitle: z.string().nullable(),
})
const followed = common.extend({
  kind: z.literal('followed'),
  deckSlug: z.null(),
  deckTitle: z.null(),
  targetSlug: z.null(),
  targetTitle: z.null(),
})

const joined = followed.extend({ kind: z.literal('github_followee_joined') })

export const notificationSchema = z
  .discriminatedUnion('kind', [cited, published, followed, joined])
  .transform((row) => {
    const fields = {
      id: row.id,
      at: row.at,
      unread: row.readAt === null,
      actor: { handle: row.actorHandle },
    }
    if (row.kind === 'github_followee_joined' || row.kind === 'followed')
      return { ...fields, kind: row.kind } as const
    const deck = {
      handle: row.actorHandle,
      slug: row.deckSlug,
      title: row.deckTitle,
    }
    if (row.kind === 'followee_published')
      return { ...fields, kind: row.kind, deck } as const
    return {
      ...fields,
      kind: row.kind,
      deck,
      target: { slug: row.targetSlug, title: row.targetTitle },
    } as const
  })

export type Notification = z.infer<typeof notificationSchema>
