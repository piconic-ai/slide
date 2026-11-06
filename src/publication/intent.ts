import { z } from 'zod'

export type PublishIntent = 'published' | 'unpublished'

/**
 * The `publication` section of an upload start, matching the manifest's
 * `publication.published`. It only takes effect in repository mode.
 */
const publicationSchema = z.strictObject({ published: z.boolean() })

export type StartRequest = Readonly<{
  /** Everything except `publication`, for the inventory parser. */
  inventory: unknown
  intent: PublishIntent | null
}>

/** Separates the optional publication request from the upload inventory. */
export function parseStartRequest(input: unknown): StartRequest {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return { inventory: input, intent: null }
  const { publication, ...inventory } = input as Record<string, unknown>
  if (publication === undefined) return { inventory, intent: null }
  const { published } = publicationSchema.parse(publication)
  return { inventory, intent: published ? 'published' : 'unpublished' }
}
