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

export type StartRequest = Readonly<{
  attempt: UploadAttempt
  /** Everything except `attempt`, for the inventory parser. */
  inventory: unknown
}>

/** Separates the attempt from the upload inventory. Throws when it is missing or malformed. */
export function parseStartRequest(input: unknown): StartRequest {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new Error('Upload start must be an object')
  const { attempt, ...inventory } = input as Record<string, unknown>
  return { attempt: attemptSchema.parse(attempt), inventory }
}

/** The key under which one attempt at a new version of a deck is stored. */
export function versionKey(deckId: string, attempt: UploadAttempt): string {
  return `${deckId}:${attempt}`
}
