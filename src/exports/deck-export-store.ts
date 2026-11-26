// Reads what one slide's export is made of. Every query names the person
// the data must belong to and carries it in its own condition, so a slide,
// a version or a file of someone else is never returned, whatever the
// caller passed. A missing and a foreign slide both come back as null.
import { and, asc, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import { decks, deployments, uploadFiles } from '../db/schema'
import type { DeckId, DeckSlug } from '../decks/deck-id'
import { listDeckEvents } from '../events/store'
import { listLinks } from '../links/store'
import {
  readLatestReady,
  readPointedVersion,
  readPublication,
} from '../publication/store'
import { pointedId } from '../publication/panel'
import type { DeckPublication } from '../publication/state'
import type { PointedVersion } from '../publication/store'
import { readArticle } from '../articles/store'
import { readHandle } from '../share/store'
import { sharePath } from '../share/path'
import { slideInfo } from './slide-info'
import { exportVersions, type ExportVersions } from './versions'

const deckRowSchema = z.object({
  id: z.string(),
  slug: z.string(),
  createdAt: z.number().int(),
  firstPublishedAt: z.number().int().nullable(),
  hiddenAt: z.number().int().nullable(),
})

export type ExportDeck = Readonly<{
  id: DeckId
  slug: string
  createdAt: number
  firstPublishedAt: number | null
  hidden: boolean
  publication: DeckPublication
  versions: ExportVersions
  hasArticle: boolean
}>

/**
 * The person's own live slide by its URL name, with the versions that may be
 * exported; null for a slide that is not there, is not theirs, or is waiting
 * to be purged.
 */
export async function readExportDeck(
  database: D1Database,
  ownerUserId: string,
  slug: string,
): Promise<ExportDeck | null> {
  const row = await drizzle(database)
    .select({
      id: decks.id,
      slug: decks.slug,
      createdAt: decks.created_at,
      firstPublishedAt: decks.first_published_at,
      hiddenAt: decks.hidden_at,
    })
    .from(decks)
    .where(
      and(
        eq(decks.owner_user_id, ownerUserId),
        eq(decks.slug, slug),
        isNull(decks.deleted_at),
      ),
    )
    .get()
  if (!row) return null
  const deck = deckRowSchema.parse(row)
  const publication = await readPublication(database, deck.id, ownerUserId)
  if (!publication) return null
  const pointed = pointedId(publication)
  const [pointedVersion, latest, article] = await Promise.all([
    pointed ? readPointedVersion(database, deck.id, pointed) : null,
    readLatestReady(database, deck.id),
    readArticle(database, deck.id),
  ])
  return {
    id: deck.id as DeckId,
    slug: deck.slug,
    createdAt: deck.createdAt,
    firstPublishedAt: deck.firstPublishedAt,
    hidden: deck.hiddenAt !== null,
    publication,
    versions: exportVersions(publication.publication, pointedVersion, latest),
    hasArticle: article !== null,
  }
}

const fileRowSchema = z.object({
  path: z.string(),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  mediaType: z.string(),
  objectKey: z.string().nullable(),
})

export type VersionFile = Readonly<{
  path: string
  size: number
  sha256: string
  mediaType: string
  /**
   * Where the bytes are in R2; null for a file not stored, which a ready
   * version has none of. Never leaves the service.
   */
  objectKey: string | null
}>

export type ExportVersionFiles =
  | Readonly<{
      kind: 'files'
      version: PointedVersion
      title: string | null
      description: string | null
      totalBytes: number
      files: readonly VersionFile[]
    }>
  /** The version is not a received version of this person's slide. */
  | Readonly<{ kind: 'missing' }>

/**
 * The files of one received version of the person's slide, by path. The
 * owner, the slide and the version are one condition of the query: a version
 * of another person's slide, or of another slide, matches nothing.
 */
export async function readVersionFiles(
  database: D1Database,
  input: Readonly<{
    ownerUserId: string
    deckId: string
    version: PointedVersion
  }>,
): Promise<ExportVersionFiles> {
  const db = drizzle(database)
  const [version] = await db
    .select({
      title: deployments.title,
      description: deployments.description,
      totalBytes: deployments.total_bytes,
    })
    .from(deployments)
    .innerJoin(decks, eq(decks.id, deployments.deck_id))
    .where(
      and(
        eq(deployments.id, input.version.deploymentId),
        eq(deployments.deck_id, input.deckId),
        eq(deployments.state, 'ready'),
        eq(decks.owner_user_id, input.ownerUserId),
        isNull(decks.deleted_at),
      ),
    )
    .limit(1)
  if (!version) return { kind: 'missing' }
  const rows = await db
    .select({
      path: uploadFiles.path,
      size: uploadFiles.size,
      sha256: uploadFiles.sha256,
      mediaType: uploadFiles.media_type,
      objectKey: uploadFiles.object_key,
    })
    .from(uploadFiles)
    .where(eq(uploadFiles.deployment_id, input.version.deploymentId))
    .orderBy(asc(uploadFiles.path))
  const files = rows.map((row) => fileRowSchema.parse(row))
  return {
    kind: 'files',
    version: input.version,
    title: version.title,
    description: version.description,
    totalBytes: version.totalBytes,
    files,
  }
}

/** What the slide's information file needs besides the files. */
export async function readSlideFacts(
  database: D1Database,
  ownerUserId: string,
  deck: ExportDeck,
) {
  const [links, events, article, handle] = await Promise.all([
    listLinks(database, deck.id),
    listDeckEvents(database, deck.id),
    readArticle(database, deck.id),
    readHandle(database, ownerUserId),
  ])
  return { links, events, article, handle }
}

/**
 * The slide's information file as a value: the slide, its related links, its
 * events and article, and the files of each exported version. A version the
 * database no longer has is left out.
 */
export async function readSlideInfo(
  database: D1Database,
  input: Readonly<{
    ownerUserId: string
    deck: ExportDeck
    origin: string
    now: number
  }>,
) {
  const { deck } = input
  const [facts, ...versions] = await Promise.all([
    readSlideFacts(database, input.ownerUserId, deck),
    ...(['published', 'prepared'] as const).map(async (role) => {
      const version = deck.versions[role]
      if (!version) return null
      const read = await readVersionFiles(database, {
        ownerUserId: input.ownerUserId,
        deckId: deck.id,
        version,
      })
      return read.kind === 'files' ? { role, read } : null
    }),
  ])
  const present = versions.flatMap((entry) => (entry ? [entry] : []))
  const shown = present[0]?.read.title ?? null
  return slideInfo({
    exportedAt: input.now,
    slide: {
      urlName: deck.slug,
      title: shown,
      publication: deck.publication.publication.kind,
      hiddenByOperator: deck.hidden,
      createdAt: deck.createdAt,
      firstPublishedAt: deck.firstPublishedAt,
      shareUrl: facts.handle
        ? new URL(sharePath(facts.handle, deck.slug as DeckSlug), input.origin)
            .href
        : null,
    },
    links: facts.links,
    events: facts.events,
    article: facts.article && {
      status: facts.article.status,
      updatedAt: facts.article.updatedAt,
      hasUnpublishedEdit: facts.article.draftBody !== null,
    },
    versions: present.map(({ role, read }) => ({
      role,
      deploymentId: read.version.deploymentId,
      title: read.title,
      description: read.description,
      receivedAt: read.version.readyAt,
      totalBytes: read.totalBytes,
      files: read.files,
    })),
  })
}
