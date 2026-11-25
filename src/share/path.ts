import { deckSlugSchema, type DeckSlug } from '../decks/deck-id'
import { handleSchema, type Handle } from './handle'

export type SharePath =
  | Readonly<{ kind: 'deck'; handle: Handle; slug: DeckSlug }>
  /** One page of a deck, such as /@kfly8/good-slide/6, counted from 1. */
  | Readonly<{ kind: 'page'; handle: Handle; slug: DeckSlug; page: number }>
  /** An author's profile, such as /@kfly8, listing their public decks. */
  | Readonly<{ kind: 'profile'; handle: Handle }>
  /** Who an author follows, or who follows them: /@kfly8/following. */
  | Readonly<{ kind: 'people'; handle: Handle; list: PeopleList }>
  /** The slides an author cited, or that cited them: /@kfly8/cited. */
  | Readonly<{ kind: 'citations'; handle: Handle; list: CitationList }>
  /** The communities an author follows: /@kfly8/communities. */
  | Readonly<{ kind: 'communities'; handle: Handle }>
  /** The same deck under its canonical spelling. */
  | Readonly<{ kind: 'redirect'; path: string }>
  | Readonly<{ kind: 'invalid' }>

/** Whether a raw request path is under share URLs, `@` encoded or not. */
export const isSharePath = (pathname: string) =>
  pathname.startsWith('/@') || pathname.toLowerCase().startsWith('/%40')

/** The lists of people a profile has, named as their paths spell them. */
export const PEOPLE_LISTS = ['following', 'followers'] as const
export type PeopleList = (typeof PEOPLE_LISTS)[number]

/** The lists of citations a profile has, named as their paths spell them. */
export const CITATION_LISTS = ['citing', 'cited'] as const
export type CitationList = (typeof CITATION_LISTS)[number]

/** The segment that names a profile's list of communities. */
export const COMMUNITIES_LIST = 'communities'

const citationListOf = (segment: string): CitationList | null =>
  CITATION_LISTS.find((list) => list === segment) ?? null

const peopleListOf = (segment: string): PeopleList | null =>
  PEOPLE_LISTS.find((list) => list === segment) ?? null

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
 * `/@kfly8/following` and `/@kfly8/followers` always name the profile's
 * lists of people, `/@kfly8/citing` and `/@kfly8/cited` its lists of
 * citations, and `/@kfly8/communities` its list of communities, never a
 * deck: no deck can take those names, and one that somehow holds one stays
 * behind the list.
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
  const list = profileListOf(handle.data, slugSegment.toLowerCase())
  if (list !== null)
    return pageSegment === undefined
      ? spelled(pathname, list.canonical, list.path)
      : invalid
  const slug = deckSlugSchema.safeParse(slugSegment.toLowerCase())
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
 * The list of a profile a path's second segment names, with its canonical
 * path, or null when it names none (and may name a deck).
 */
function profileListOf(
  handle: Handle,
  segment: string,
): Readonly<{ canonical: string; path: SharePath }> | null {
  const people = peopleListOf(segment)
  if (people !== null)
    return {
      canonical: peoplePath(handle, people),
      path: { kind: 'people', handle, list: people },
    }
  const citations = citationListOf(segment)
  if (citations !== null)
    return {
      canonical: citationsPath(handle, citations),
      path: { kind: 'citations', handle, list: citations },
    }
  if (segment === COMMUNITIES_LIST)
    return {
      canonical: communitiesPath(handle),
      path: { kind: 'communities', handle },
    }
  return null
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

/** The path of a profile's list of people; later pages are named by number. */
export const peoplePath = (handle: Handle, list: PeopleList, page = 1) =>
  page === 1 ? `/@${handle}/${list}` : `/@${handle}/${list}?page=${page}`

/** The path of a profile's list of citations; later pages are named by number. */
export const citationsPath = (handle: Handle, list: CitationList, page = 1) =>
  page === 1 ? `/@${handle}/${list}` : `/@${handle}/${list}?page=${page}`

/** The path of a profile's list of the communities its author follows. */
export const communitiesPath = (handle: Handle) =>
  `/@${handle}/${COMMUNITIES_LIST}`

/** The share URL path of a deck, or of one of its pages. */
export const sharePath = (handle: Handle, slug: DeckSlug, page?: number) =>
  page === undefined ? `/@${handle}/${slug}` : `/@${handle}/${slug}/${page}`

/**
 * Where the author opens one version of their slides in the viewer, whether
 * or not it is public: `?v=<version>`. The author's screens link here. It is
 * not a share URL: it carries no secret, readers it does nothing for, and
 * the viewer never offers it to copy.
 */
export const ownerViewerPath = (
  handle: Handle,
  slug: DeckSlug,
  deploymentId: string | null,
) =>
  deploymentId === null
    ? sharePath(handle, slug)
    : `${sharePath(handle, slug)}?v=${deploymentId}`

/** A canonical share destination for a reader returning from a form or sign-in. */
export function returnToShare(input: unknown): string {
  if (typeof input !== 'string') return '/slides'
  const path = parseSharePath(input)
  switch (path.kind) {
    case 'profile':
      return profilePath(path.handle)
    case 'people':
      return peoplePath(path.handle, path.list)
    case 'citations':
      return citationsPath(path.handle, path.list)
    case 'communities':
      return communitiesPath(path.handle)
    case 'deck':
      return sharePath(path.handle, path.slug)
    case 'page':
      return sharePath(path.handle, path.slug, path.page)
    case 'redirect':
    case 'invalid':
      return '/slides'
  }
}
