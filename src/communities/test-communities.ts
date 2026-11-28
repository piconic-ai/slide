import { drizzle } from 'drizzle-orm/d1'
import {
  communities,
  communityAdmins,
  communityFeedEvents,
  communityFollows,
  communityLinks,
  notifications,
} from '../db/schema'
import { addLink } from '../links/store'
import { parseLinkInput, type LinkKind } from '../links/link'
import { resetTables } from '../publication/test-support'
import type { Handle } from '../share/handle'
import { checkCommunityLinks } from './link-rules'
import { createCommunity } from './store'

/** Clears the tables of communities, then those publication tests use. */
export async function resetCommunities(db: D1Database) {
  const orm = drizzle(db)
  await orm.batch([
    orm.delete(notifications),
    orm.delete(communityFollows),
    orm.delete(communityFeedEvents),
    orm.delete(communityLinks),
    orm.delete(communityAdmins),
    orm.delete(communities),
  ])
  await resetTables(db)
}

/** Makes a community the way the form does; throws when it is refused. */
export async function seedCommunity(
  db: D1Database,
  input: Readonly<{
    id: number
    handle: string
    links: readonly string[]
    name?: string
    creator?: string
    now?: number
  }>,
) {
  const links = checkCommunityLinks(input.links)
  if (!links.ok) throw new Error(`bad links: ${JSON.stringify(links)}`)
  const result = await createCommunity(db, {
    id: input.id,
    handle: input.handle as Handle,
    name: input.name ?? input.handle,
    color: 'red',
    links: links.links,
    creator: input.creator ?? '722500',
    now: input.now ?? 1000,
  })
  if (result.kind !== 'created')
    throw new Error(`not created: ${JSON.stringify(result)}`)
}

/** Adds a related link to a deck, of the kind "event" unless another is given. */
export async function seedTalkLink(
  db: D1Database,
  input: Readonly<{
    deckId: string
    url: string
    owner?: string
    title?: string
    kind?: LinkKind
  }>,
) {
  const parsed = parseLinkInput({
    kind: input.kind ?? 'event',
    url: input.url,
    title: input.title ?? '',
  })
  if (!parsed.ok) throw new Error(`bad link: ${parsed.reason}`)
  const result = await addLink(db, {
    deckId: input.deckId,
    ownerUserId: input.owner ?? '722500',
    link: parsed.link,
    now: 100,
  })
  if (result !== 'added') throw new Error(`not added: ${result}`)
}
