import type { DeckSlug } from '../decks/deck-id'
import type { NamedEvent } from '../links/link-heading'
import type { Handle } from '../share/handle'
import type { CommunityColor, Cover } from '../site/cover-pattern'
import type { StoredCommunityLink } from './store'

/** A community as its pages show it. */
export type Community = Readonly<{
  id: number
  handle: Handle
  name: string
  description: string
  color: CommunityColor
  /** The other links (D-37), up to three. */
  sites: readonly string[]
  /** When the logo was put up, in milliseconds; null shows the initial. */
  logoAt: number | null
  /** When the cover was put up, in milliseconds; null shows the pattern. */
  coverAt: number | null
  links: readonly StoredCommunityLink[]
}>

/** A public slide given as a talk of one of a community's events. */
export type CommunityTalk = Readonly<{
  deckId: string
  handle: Handle
  slug: DeckSlug
  title: string | null
  /** When the slide was first published, in seconds. */
  publishedAt: number
  deploymentId: string
  coverPath: string | null
}>

/**
 * One of a community's links as its page of links gathers them (F30-AC68),
 * with its public slides in the community, newest first.
 */
export type CommunityLink = NamedEvent &
  Readonly<{
    /** The event the link is kept as; null for a link of another kind. */
    eventId: number | null
    /** The address its page of links is found by: `events.url`, or the key. */
    url: string
    talks: readonly CommunityTalk[]
  }>

/** Where a community's logo and cover are served, by its number. */
export const logoPath = (communityId: number, at: number) =>
  `/communities/${communityId}/logo?v=${at}`
export const coverPath = (communityId: number, at: number) =>
  `/communities/${communityId}/cover?v=${at}`

/** The community an event is shown with, on its page and in its rows. */
export type EventCommunityView = Readonly<{
  id: number
  handle: Handle
  name: string
  color: CommunityColor
  logoAt: number | null
  coverAt: number | null
}>

/** Where a community's page is. */
export const communityHref = (handle: Handle) => `/@${handle}`

/**
 * A community's cover, on its page and on its events' pages (D-46, D-49):
 * the uploaded one, or the community's default pattern.
 */
export const communityCoverOf = (
  community: Pick<EventCommunityView, 'id' | 'color' | 'coverAt'>,
): Cover =>
  community.coverAt === null
    ? { kind: 'pattern', color: community.color, seed: community.id }
    : { kind: 'image', url: coverPath(community.id, community.coverAt) }

/** Where the editing forms of one community post. */
export const communityActionPath = (communityId: number, action: string) =>
  `/communities/${communityId}/${action}`
