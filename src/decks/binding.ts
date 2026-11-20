import { z } from 'zod'

const NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

/** The key of a deck: what other tables point at. */
export const deckIdSchema = z
  .string()
  .regex(NAME, 'Invalid deck ID')
  .brand<'DeckId'>()
export type DeckId = z.infer<typeof deckIdSchema>

/**
 * The name an author chose for a deck, the last part of /@handle/slug. A
 * different type from DeckId, so that one cannot be passed for the other.
 */
export const deckSlugSchema = z
  .string()
  .regex(NAME, 'Invalid deck slug')
  .brand<'DeckSlug'>()
export type DeckSlug = z.infer<typeof deckSlugSchema>
