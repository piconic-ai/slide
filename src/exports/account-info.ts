// The account file (D-34). Pure: facts in, the JSON value out.
import type { Publication } from '../publication/state'
import { sharePath } from '../share/path'
import type { DeckSlug } from '../decks/deck-id'
import type { Handle } from '../share/handle'

/** See SLIDE_INFO_SCHEMA_VERSION; the two files are versioned separately. */
export const ACCOUNT_INFO_SCHEMA_VERSION = 1

type Since = Readonly<{ handle: string; at: number }>

export type AccountSlide = Readonly<{
  urlName: string
  title: string | null
  publication: Publication['kind']
  hiddenByOperator: boolean
  createdAt: number
  firstPublishedAt: number | null
  /** Other people's slides (or the author's own) this slide cites. */
  cites: readonly Readonly<{ handle: Handle; slug: DeckSlug; page: number }>[]
}>

export type AccountInfoInput = Readonly<{
  exportedAt: number
  /** The service's public origin, which share URLs are made against. */
  origin: string
  account: Readonly<{
    handle: Handle
    email: string | null
    createdAt: number
    termsAcceptedAt: number | null
  }>
  profile: Readonly<{
    name: string
    bio: string | null
    location: string | null
    website: string | null
    links: readonly string[]
    useGravatar: boolean
    hasUploadedPicture: boolean
  }> | null
  following: readonly Since[]
  followingCommunities: readonly Readonly<{
    handle: string
    name: string
    at: number
  }>[]
  muted: readonly Since[]
  blocked: readonly Since[]
  managedCommunities: readonly Readonly<{
    handle: string
    name: string
    description: string
    color: string
    sites: readonly string[]
    links: readonly Readonly<{ kind: string; url: string }>[]
    adminSince: number
  }>[]
  agents: readonly Readonly<{
    name: string
    connectedAt: number
    lastUsedAt: number | null
  }>[]
  slides: readonly AccountSlide[]
}>

const iso = (seconds: number) => new Date(seconds * 1000).toISOString()

const withTime = ({ handle, at }: Since) => ({ handle, since: iso(at) })

/**
 * The file as a value to print as JSON. It holds what belongs to the person:
 * their own record and the choices they made. Other people appear only by
 * the handle the person chose to follow, mute or block, never by anything
 * they hold (no followers, no one who blocked or muted them). Tokens of an
 * agent's connection are not kept anywhere readable, so none can be here.
 */
export function accountInfo(input: AccountInfoInput) {
  const share = (handle: Handle, slug: DeckSlug, page?: number) =>
    new URL(sharePath(handle, slug, page), input.origin).href
  return {
    schemaVersion: ACCOUNT_INFO_SCHEMA_VERSION,
    kind: 'account',
    exportedAt: iso(input.exportedAt),
    account: {
      handle: input.account.handle,
      email: input.account.email,
      createdAt: iso(input.account.createdAt),
      termsAcceptedAt:
        input.account.termsAcceptedAt === null
          ? null
          : iso(input.account.termsAcceptedAt),
    },
    profile: input.profile && {
      name: input.profile.name,
      bio: input.profile.bio,
      location: input.profile.location,
      website: input.profile.website,
      links: input.profile.links,
      useGravatar: input.profile.useGravatar,
      hasUploadedPicture: input.profile.hasUploadedPicture,
    },
    following: input.following.map(withTime),
    followingCommunities: input.followingCommunities.map((community) => ({
      handle: community.handle,
      name: community.name,
      since: iso(community.at),
    })),
    muted: input.muted.map(withTime),
    blocked: input.blocked.map(withTime),
    managedCommunities: input.managedCommunities.map(
      ({ adminSince, ...community }) => ({
        ...community,
        adminSince: iso(adminSince),
      }),
    ),
    aiAgents: input.agents.map((agent) => ({
      name: agent.name,
      connectedAt: iso(agent.connectedAt),
      lastUsedAt: agent.lastUsedAt === null ? null : iso(agent.lastUsedAt),
    })),
    slides: input.slides.map((slide) => ({
      urlName: slide.urlName,
      title: slide.title,
      state: slide.publication,
      hiddenByOperator: slide.hiddenByOperator,
      createdAt: iso(slide.createdAt),
      firstPublishedAt:
        slide.firstPublishedAt === null ? null : iso(slide.firstPublishedAt),
      shareUrl: share(input.account.handle, slide.urlName as DeckSlug),
      // Slides of other people are only their URLs (D-34).
      cites: slide.cites.map((cite) =>
        share(cite.handle, cite.slug, cite.page === 0 ? undefined : cite.page),
      ),
    })),
  }
}
