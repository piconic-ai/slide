import { deckIdSchema, type DeckId } from '../decks/binding'
import { handleSchema, type Handle } from './handle'

export type SharePath =
  | Readonly<{ kind: 'deck'; handle: Handle; slug: DeckId }>
  /** An author's profile, such as /@kfly8, listing their public decks. */
  | Readonly<{ kind: 'profile'; handle: Handle }>
  /** The same deck under its canonical spelling. */
  | Readonly<{ kind: 'redirect'; path: string }>
  | Readonly<{ kind: 'invalid' }>

/** Whether a raw request path is under share URLs, `@` encoded or not. */
export const isSharePath = (pathname: string) =>
  pathname.startsWith('/@') || pathname.toLowerCase().startsWith('/%40')

const invalid = { kind: 'invalid' } as const satisfies SharePath

/**
 * Reads a raw share path: a profile such as `/@kfly8`, or a deck such as
 * `/@kfly8/good-slide`. Handles and deck IDs are lowercase and unencoded,
 * so uppercase, encoded or trailing-slash spellings of a valid path
 * redirect to that one path.
 */
export function parseSharePath(pathname: string): SharePath {
  const segments = pathname.split('/').slice(1)
  if (segments.length > 1 && segments.at(-1) === '') segments.pop()
  if (segments.length > 2) return invalid
  let decoded: string[]
  try {
    decoded = segments.map(decodeURIComponent)
  } catch {
    return invalid
  }
  const [handleSegment = '', slugSegment] = decoded
  if (!handleSegment.startsWith('@')) return invalid
  const handle = handleSchema.safeParse(handleSegment.slice(1).toLowerCase())
  if (!handle.success) return invalid
  if (slugSegment === undefined) {
    const canonical = profilePath(handle.data)
    return pathname === canonical
      ? { kind: 'profile', handle: handle.data }
      : { kind: 'redirect', path: canonical }
  }
  const slug = deckIdSchema.safeParse(slugSegment.toLowerCase())
  if (!slug.success) return invalid
  const canonical = sharePath(handle.data, slug.data)
  return pathname === canonical
    ? { kind: 'deck', handle: handle.data, slug: slug.data }
    : { kind: 'redirect', path: canonical }
}

/** The path of an author's profile. */
export const profilePath = (handle: Handle) => `/@${handle}`

/** The share URL path of a deck. */
export const sharePath = (handle: Handle, slug: DeckId) => `/@${handle}/${slug}`
