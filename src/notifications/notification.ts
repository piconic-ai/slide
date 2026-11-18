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
] as const satisfies readonly NotificationKind[]

const common = z.object({
  id: z.string(),
  at: z.number().int(),
  readAt: z.number().int().nullable(),
  actorHandle: handleSchema,
})
const cited = common.extend({
  kind: z.literal('cited'),
  deckSlug: deckSlugSchema,
  deckTitle: z.string().nullable(),
  targetSlug: deckSlugSchema,
  targetTitle: z.string().nullable(),
})
const joined = common.extend({
  kind: z.literal('github_followee_joined'),
  deckSlug: z.null(),
  deckTitle: z.null(),
  targetSlug: z.null(),
  targetTitle: z.null(),
})

export const notificationSchema = z
  .discriminatedUnion('kind', [cited, joined])
  .transform((row) => {
    const fields = {
      id: row.id,
      at: row.at,
      unread: row.readAt === null,
      actor: { handle: row.actorHandle },
    }
    if (row.kind === 'github_followee_joined')
      return { ...fields, kind: row.kind } as const
    return {
      ...fields,
      kind: row.kind,
      deck: {
        handle: row.actorHandle,
        slug: row.deckSlug,
        title: row.deckTitle,
      },
      target: { slug: row.targetSlug, title: row.targetTitle },
    } as const
  })

export type Notification = z.infer<typeof notificationSchema>
