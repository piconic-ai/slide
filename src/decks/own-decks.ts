import { z } from 'zod'

/** One of the author's own slides, as their lists show it. */
export type OwnDeck = Readonly<{
  slug: string
  /** Whether readers can open it now: published, not paused, not hidden. */
  isPublic: boolean
  /** The version the list shows: the public one, or else the newest ready. */
  shown: Readonly<{
    deploymentId: string
    title: string | null
    coverPath: string | null
  }> | null
  /** When it last changed: its newest ready version, or else its creation. */
  updatedAt: number
}>

/** A row of the list query, before it is told apart into an OwnDeck. */
export const ownDeckRowSchema = z.object({
  slug: z.string(),
  created_at: z.number(),
  public_deployment_id: z.string().nullable(),
  paused_at: z.number().nullable(),
  hidden_at: z.number().nullable(),
  shown_id: z.string().nullable(),
  shown_title: z.string().nullable(),
  shown_cover_path: z.string().nullable(),
  newest_ready_at: z.number().nullable(),
})

export type OwnDeckRow = z.infer<typeof ownDeckRowSchema>

export const toOwnDeck = (row: OwnDeckRow): OwnDeck => ({
  slug: row.slug,
  isPublic:
    row.public_deployment_id !== null &&
    row.paused_at === null &&
    row.hidden_at === null,
  shown:
    row.shown_id === null
      ? null
      : {
          deploymentId: row.shown_id,
          title: row.shown_title,
          coverPath: row.shown_cover_path,
        },
  updatedAt: row.newest_ready_at ?? row.created_at,
})

/** A slide is named by its title, or by its URL name before it has one. */
export const ownDeckName = (deck: OwnDeck) => deck.shown?.title ?? deck.slug
