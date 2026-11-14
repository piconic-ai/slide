import { deckIdSchema, type DeckId } from '../decks/binding'
import { handleSchema, type Handle } from './handle'

export type SharePath =
  | Readonly<{ kind: 'deck'; handle: Handle; slug: DeckId }>
  /** One page of a deck, such as /@kfly8/good-slide/6, counted from 1. */
  | Readonly<{ kind: 'page'; handle: Handle; slug: DeckId; page: number }>
  /** An author's profile, such as /@kfly8, listing their public decks. */
  | Readonly<{ kind: 'profile'; handle: Handle }>
  /** The same deck under its canonical spelling. */
  | Readonly<{ kind: 'redirect'; path: string }>
  | Readonly<{ kind: 'invalid' }>

/** Whether a raw request path is under share URLs, `@` encoded or not. */
export const isSharePath = (pathname: string) =>
  pathname.startsWith('/@') || pathname.toLowerCase().startsWith('/%40')

const invalid = { kind: 'invalid' } as const satisfies SharePath

/** The last page number a share URL can name. */
export const MAX_PAGE = 9999

/** A page number as a path spells it: 1 to MAX_PAGE, without a sign. */
export function parsePage(segment: string): number | null {
  if (!/^[0-9]{1,4}$/.test(segment)) return null
  const page = Number(segment)
  return page >= 1 && page <= MAX_PAGE ? page : null
}

/**
 * Reads a raw share path: a profile such as `/@kfly8`, a deck such as
 * `/@kfly8/good-slide`, or one of its pages such as `/@kfly8/good-slide/6`.
 * Handles and deck IDs are lowercase and unencoded, so uppercase, encoded,
 * zero-padded or trailing-slash spellings of a valid path redirect to that
 * one path.
 */
export function parseSharePath(pathname: string): SharePath {
  const decoded = decodeSegments(pathname)
  if (!decoded) return invalid
  const [handleSegment = '', slugSegment, pageSegment] = decoded
  if (!handleSegment.startsWith('@')) return invalid
  const handle = handleSchema.safeParse(handleSegment.slice(1).toLowerCase())
  if (!handle.success) return invalid
  if (slugSegment === undefined)
    return spelled(pathname, profilePath(handle.data), {
      kind: 'profile',
      handle: handle.data,
    })
  const slug = deckIdSchema.safeParse(slugSegment.toLowerCase())
  if (!slug.success) return invalid
  const deck = { handle: handle.data, slug: slug.data }
  if (pageSegment === undefined)
    return spelled(pathname, sharePath(deck.handle, deck.slug), {
      kind: 'deck',
      ...deck,
    })
  const page = parsePage(pageSegment)
  if (page === null) return invalid
  return spelled(pathname, sharePath(deck.handle, deck.slug, page), {
    kind: 'page',
    ...deck,
    page,
  })
}

/**
 * The decoded segments of a path of up to three, ignoring one trailing
 * slash, or null when there are more or one is not valid encoding.
 */
function decodeSegments(pathname: string): string[] | null {
  const segments = pathname.split('/').slice(1)
  if (segments.length > 1 && segments.at(-1) === '') segments.pop()
  if (segments.length > 3) return null
  try {
    return segments.map(decodeURIComponent)
  } catch {
    return null
  }
}

/** What a path names when spelled canonically, else a redirect there. */
const spelled = (
  pathname: string,
  canonical: string,
  path: SharePath,
): SharePath =>
  pathname === canonical ? path : { kind: 'redirect', path: canonical }

/** The path of an author's profile. */
export const profilePath = (handle: Handle) => `/@${handle}`

/** The share URL path of a deck, or of one of its pages. */
export const sharePath = (handle: Handle, slug: DeckId, page?: number) =>
  page === undefined ? `/@${handle}/${slug}` : `/@${handle}/${slug}/${page}`
