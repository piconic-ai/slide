import { z } from 'zod'

/**
 * The name a sender gives one try at sending one set of files. Starting
 * again with the same attempt continues the same upload instead of making
 * another.
 */
export const attemptSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,64}$/)
  .brand<'UploadAttempt'>()
export type UploadAttempt = z.infer<typeof attemptSchema>

/** What a sender knows of a new slide's name; see ../decks/slug-name. */
const nameSchema = z
  .strictObject({
    title: z.string().max(1000).optional(),
    fileName: z.string().max(1000).optional(),
  })
  .default({})
export type StartName = z.infer<typeof nameSchema>

export type StartRequest = Readonly<{
  attempt: UploadAttempt
  /** Only a start that makes a new slide reads it. */
  name: StartName
  /** Everything except `attempt` and `name`, for the inventory parser. */
  inventory: unknown
}>

/**
 * Separates the attempt and the name from the upload inventory. Throws when
 * the attempt is missing or either is malformed.
 */
export function parseStartRequest(input: unknown): StartRequest {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new Error('Upload start must be an object')
  const { attempt, name, ...inventory } = input as Record<string, unknown>
  return {
    attempt: attemptSchema.parse(attempt),
    name: nameSchema.parse(name),
    inventory,
  }
}

/** The key under which one attempt at a new version of a deck is stored. */
export function versionKey(deckId: string, attempt: UploadAttempt): string {
  return `${deckId}:${attempt}`
}

/**
 * The key under which one attempt at a new slide is stored. The slide has no
 * key of its own before the start, so the author's stands in; `new` cannot
 * begin a deck key followed by a colon, so the two kinds never collide.
 */
export function newSlideKey(
  ownerUserId: string,
  attempt: UploadAttempt,
): string {
  return `new:${ownerUserId}:${attempt}`
}

/**
 * Whether a request says it comes from a page of the service itself: its
 * Origin header is the origin of the URL it was sent to. A browser sets the
 * header on every POST and a page cannot change it, so a request another
 * site made the browser send, or one from a sandboxed frame (`null`), does
 * not pass. A request without the header does not pass either.
 */
export function isOwnOrigin(
  origin: string | undefined,
  requestUrl: string,
): boolean {
  return origin !== undefined && origin === new URL(requestUrl).origin
}
