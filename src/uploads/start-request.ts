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

/**
 * What a sender knows of a new slide's name; see ../decks/slug-name. A part
 * that is left out or null is not known.
 */
const nameSchema = z
  .strictObject({
    title: z.string().max(1000).nullish(),
    fileName: z.string().max(1000).nullish(),
  })
  .nullish()
  .transform((name) => name ?? {})
export type StartName = z.infer<typeof nameSchema>

export type StartRequest = Readonly<{
  attempt: UploadAttempt
  /** Only a start that makes a new slide reads it. */
  name: StartName
  /** Everything except `attempt` and `name`, for the inventory parser. */
  inventory: unknown
}>

/** Which part of a start is not what it should be. */
export type StartField = 'body' | 'attempt' | 'name'

/** A start whose `field` is missing or malformed. */
export class StartRequestError extends Error {
  constructor(readonly field: StartField) {
    super(`Invalid upload start: ${field}`)
    this.name = 'StartRequestError'
  }
}

/**
 * Separates the attempt and the name from the upload inventory. Throws a
 * StartRequestError that says which of them is missing or malformed.
 */
export function parseStartRequest(input: unknown): StartRequest {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new StartRequestError('body')
  const { attempt, name, ...inventory } = input as Record<string, unknown>
  const parsedAttempt = attemptSchema.safeParse(attempt)
  if (!parsedAttempt.success) throw new StartRequestError('attempt')
  const parsedName = nameSchema.safeParse(name)
  if (!parsedName.success) throw new StartRequestError('name')
  return { attempt: parsedAttempt.data, name: parsedName.data, inventory }
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
