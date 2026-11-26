// Reads what the account file is made of. Each query starts from the
// person's own rows (they are the follower, the muter, the blocker, the
// admin, the owner), never from the other side: nobody learns who follows,
// mutes or blocks them, or what other people hold, from this file.
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import {
  accounts,
  blocks,
  communities,
  communityAdmins,
  communityFollows,
  communityLinks,
  follows,
  handles,
  mutes,
  profileLinks,
  profilePictures,
  profiles,
} from '../db/schema'
import { listConnections } from '../mcp/connections-store'
import type { EmailCrypto } from '../db/email-cipher'
import { readEmail } from '../profile/store'
import { handleSchema, type Handle } from '../share/handle'
import { deckSlugSchema } from '../decks/deck-id'
import { accountInfo, type AccountSlide } from './account-info'
import { listSlideSummaries } from './slide-rows-store'

const communityHandle = and(
  eq(handles.owner_kind, 'community'),
  eq(handles.owner_id, sql`CAST(${communities.id} AS TEXT)`),
)

const sitesSchema = z.array(z.string())
const parseSites = (json: string): string[] => {
  try {
    return sitesSchema.parse(JSON.parse(json))
  } catch {
    return []
  }
}

async function readAccountRows(database: D1Database, userId: string) {
  const db = drizzle(database)
  return Promise.all([
    db
      .select({
        handle: accounts.handle,
        createdAt: accounts.created_at,
        termsAcceptedAt: accounts.terms_accepted_at,
      })
      .from(accounts)
      .where(eq(accounts.user_id, userId))
      .get(),
    db
      .select({
        name: profiles.name,
        bio: profiles.bio,
        location: profiles.location,
        website: profiles.website,
        useGravatar: profiles.use_gravatar,
      })
      .from(profiles)
      .where(eq(profiles.user_id, userId))
      .get(),
    db
      .select({ url: profileLinks.url })
      .from(profileLinks)
      .where(eq(profileLinks.user_id, userId))
      .orderBy(asc(profileLinks.position)),
    db
      .select({ at: profilePictures.uploaded_at })
      .from(profilePictures)
      .where(eq(profilePictures.user_id, userId))
      .get(),
    db
      .select({ handle: accounts.handle, at: follows.created_at })
      .from(follows)
      .innerJoin(accounts, eq(accounts.user_id, follows.followee_user_id))
      .where(eq(follows.follower_user_id, userId))
      .orderBy(desc(follows.created_at), asc(accounts.handle)),
    db
      .select({
        handle: handles.handle,
        name: communities.name,
        at: communityFollows.created_at,
      })
      .from(communityFollows)
      .innerJoin(communities, eq(communities.id, communityFollows.community_id))
      .innerJoin(handles, communityHandle)
      .where(eq(communityFollows.user_id, userId))
      .orderBy(desc(communityFollows.created_at), asc(communities.id)),
    db
      .select({ handle: accounts.handle, at: mutes.created_at })
      .from(mutes)
      .innerJoin(accounts, eq(accounts.user_id, mutes.muted_user_id))
      .where(eq(mutes.muter_user_id, userId))
      .orderBy(desc(mutes.created_at), asc(accounts.handle)),
    db
      .select({ handle: accounts.handle, at: blocks.created_at })
      .from(blocks)
      .innerJoin(accounts, eq(accounts.user_id, blocks.blocked_user_id))
      .where(eq(blocks.blocker_user_id, userId))
      .orderBy(desc(blocks.created_at), asc(accounts.handle)),
    db
      .select({
        id: communities.id,
        handle: handles.handle,
        name: communities.name,
        description: communities.description,
        color: communities.color,
        sites: communities.sites,
        adminSince: communityAdmins.added_at,
      })
      .from(communityAdmins)
      .innerJoin(communities, eq(communities.id, communityAdmins.community_id))
      .innerJoin(handles, communityHandle)
      .where(eq(communityAdmins.user_id, userId))
      .orderBy(asc(communities.name), asc(communities.id)),
  ])
}

/** The cited slides of each of the person's slides, by the slide's URL name. */
async function readCites(database: D1Database, userId: string) {
  const rows = await drizzle(database).all(sql`
    SELECT d.slug AS slug, c.target_handle AS handle,
           c.target_slug AS target_slug, c.target_page AS page
    FROM decks d
    JOIN citations c ON c.deployment_id IN (
      COALESCE(d.public_deployment_id, d.resume_deployment_id),
      (SELECT id FROM deployments
        WHERE deck_id = d.id AND state = 'ready'
        ORDER BY COALESCE(ready_at, created_at) DESC, rowid DESC LIMIT 1)
    )
    WHERE d.owner_user_id = ${userId} AND d.deleted_at IS NULL
    UNION
    SELECT d.slug, a.target_handle, a.target_slug, a.target_page
    FROM decks d
    JOIN article_citations a ON a.deck_id = d.id
    WHERE d.owner_user_id = ${userId} AND d.deleted_at IS NULL
    ORDER BY 1, 2, 3, 4`)
  const cites = new Map<string, AccountSlide['cites'][number][]>()
  for (const raw of rows) {
    const row = z
      .object({
        slug: z.string(),
        handle: handleSchema,
        target_slug: deckSlugSchema,
        page: z.number().int(),
      })
      .parse(raw)
    cites.set(row.slug, [
      ...(cites.get(row.slug) ?? []),
      { handle: row.handle, slug: row.target_slug, page: row.page },
    ])
  }
  return cites
}

/** The links of the communities a person runs, by community number. */
async function readCommunityLinks(database: D1Database, userId: string) {
  const rows = await drizzle(database)
    .select({
      communityId: communityLinks.community_id,
      kind: communityLinks.kind,
      url: communityLinks.url,
    })
    .from(communityLinks)
    .innerJoin(
      communityAdmins,
      and(
        eq(communityAdmins.community_id, communityLinks.community_id),
        eq(communityAdmins.user_id, userId),
      ),
    )
    .orderBy(asc(communityLinks.id))
  const links = new Map<number, { kind: string; url: string }[]>()
  for (const { communityId, ...link } of rows)
    links.set(communityId, [...(links.get(communityId) ?? []), link])
  return links
}

/**
 * The account file of one person as a value to print as JSON, or null when
 * the person has no account (they never chose a handle). The email address
 * is the person's own, in the clear; it is returned only here and in the
 * settings page.
 */
export async function readAccountInfo(
  database: D1Database,
  input: Readonly<{
    userId: string
    origin: string
    now: number
    /** How addresses are kept (F41); the file shows the address in the clear. */
    email: EmailCrypto
  }>,
) {
  const [
    account,
    profile,
    profileLinkRows,
    picture,
    following,
    followingCommunities,
    muted,
    blocked,
    managed,
  ] = await readAccountRows(database, input.userId)
  if (!account) return null
  const [email, links, connections, summaries, cites] = await Promise.all([
    // The one way the service reads an address, so how it is kept (F41)
    // changes nothing here.
    readEmail(database, input.userId, input.email),
    readCommunityLinks(database, input.userId),
    listConnections(database, input.userId, input.now),
    listSlideSummaries(database, input.userId),
    readCites(database, input.userId),
  ])
  return accountInfo({
    exportedAt: input.now,
    origin: input.origin,
    account: {
      handle: handleSchema.parse(account.handle) as Handle,
      email,
      createdAt: account.createdAt,
      termsAcceptedAt: account.termsAcceptedAt,
    },
    profile: profile
      ? {
          name: profile.name,
          bio: profile.bio,
          location: profile.location,
          website: profile.website,
          links: profileLinkRows.map(({ url }) => url),
          useGravatar: profile.useGravatar === 1,
          hasUploadedPicture: picture !== undefined,
        }
      : null,
    following,
    followingCommunities,
    muted,
    blocked,
    managedCommunities: managed.map(({ id, sites, ...community }) => ({
      ...community,
      sites: parseSites(sites),
      links: links.get(id) ?? [],
    })),
    agents: connections,
    slides: summaries.map((slide) => ({
      urlName: slide.slug,
      title: slide.title,
      publication: slide.publication,
      hiddenByOperator: slide.hiddenByOperator,
      createdAt: slide.createdAt,
      firstPublishedAt: slide.firstPublishedAt,
      cites: cites.get(slide.slug) ?? [],
    })),
  })
}
