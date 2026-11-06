import { deckIdSchema, type DeckId } from '../decks/binding'
import { handleSchema, type Handle } from './handle'

export type SharePath =
  | Readonly<{ kind: 'deck'; handle: Handle; slug: DeckId }>
  /** The same deck under its canonical, lowercase spelling. */
  | Readonly<{ kind: 'redirect'; path: string }>
  | Readonly<{ kind: 'invalid' }>

/**
 * Reads the handle and slug of a share URL such as `/@kfly8/good-slide`.
 * Handles and deck IDs are lowercase, so other spellings redirect to it.
 */
export function parseSharePath(handleSegment: string, slugSegment: string) {
  if (!handleSegment.startsWith('@')) return { kind: 'invalid' } as const
  const raw = handleSegment.slice(1)
  const handle = handleSchema.safeParse(raw.toLowerCase())
  const slug = deckIdSchema.safeParse(slugSegment.toLowerCase())
  if (!handle.success || !slug.success) return { kind: 'invalid' } as const
  if (raw !== handle.data || slugSegment !== slug.data)
    return {
      kind: 'redirect',
      path: sharePath(handle.data, slug.data),
    } as const satisfies SharePath
  return {
    kind: 'deck',
    handle: handle.data,
    slug: slug.data,
  } as const satisfies SharePath
}

/** The share URL path of a deck. */
export const sharePath = (handle: Handle, slug: DeckId) => `/@${handle}/${slug}`
