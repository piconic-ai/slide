import { and, eq, exists, gt, isNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  decks,
  repositoryBindingRowSchema,
  repositoryBindings,
  suspensions,
} from '../db/schema'
import { authAccount, authSession } from '../db/auth-schema'
import type { BindingRequest } from './binding'
import {
  deckIdSchema,
  deckSlugSchema,
  storedRefsSchema,
  type DeckId,
  type DeckSlug,
} from './binding'

export type VerifiedRepository = Readonly<{
  repositoryId: string
  repositoryOwnerId: string
  fullName: string
}>

export type SaveBindingResult =
  | 'saved'
  | 'deck_limit'
  | 'session_expired'
  /** The owner deleted the deck, and it waits to be purged. */
  | 'deleting'

/**
 * Creates the deck if needed and replaces its repository binding, but only
 * while the original session is valid, its owner is not suspended, and the
 * deck belongs to that owner and is not deleted. A new deck is
 * created only while the owner has fewer than `deckLimit` live decks.
 */
export async function saveBinding(
  database: D1Database,
  input: Readonly<{
    ownerUserId: string
    sessionId: string
    request: BindingRequest
    repository: VerifiedRepository
    deckLimit: number
    now: number
  }>,
): Promise<SaveBindingResult> {
  const db = drizzle(database)
  const { ownerUserId, sessionId, request, repository, deckLimit, now } = input
  const liveSession = db
    .select({ id: authSession.id })
    .from(authSession)
    .innerJoin(authAccount, eq(authAccount.userId, authSession.userId))
    .where(
      and(
        eq(authSession.id, sessionId),
        eq(authAccount.providerId, 'github'),
        eq(authAccount.accountId, ownerUserId),
        gt(authSession.expiresAt, sql`unixepoch('subsec') * 1000`),
        // A suspension stored while GitHub was answering must win: the
        // check belongs in the statements that write.
        sql`NOT EXISTS (SELECT 1 FROM ${suspensions}
          WHERE ${suspensions.user_id} = ${ownerUserId})`,
      ),
    )
  const refs = JSON.stringify(request.branches)
  // The key of a deck that does not exist yet; an existing deck keeps its own.
  const newDeckId = deckIdSchema.parse(crypto.randomUUID())
  const bind = db
    .insert(repositoryBindings)
    .select(
      db
        .select({
          deck_id: sql<string>`${decks.id}`.as('deck_id'),
          repository_id: sql<string>`${repository.repositoryId}`.as(
            'repository_id',
          ),
          repository_owner_id: sql<string>`${repository.repositoryOwnerId}`.as(
            'repository_owner_id',
          ),
          repository_full_name: sql<string>`${repository.fullName}`.as(
            'repository_full_name',
          ),
          allowed_refs: sql<string>`${refs}`.as('allowed_refs'),
          verified_by: sql<string>`${ownerUserId}`.as('verified_by'),
          verified_at: sql<number>`${now}`.as('verified_at'),
        })
        .from(decks)
        .where(
          and(
            eq(decks.owner_user_id, ownerUserId),
            eq(decks.slug, request.deck),
            isNull(decks.deleted_at),
            exists(liveSession),
          ),
        ),
    )
    .onConflictDoUpdate({
      target: repositoryBindings.deck_id,
      set: {
        repository_id: repository.repositoryId,
        repository_owner_id: repository.repositoryOwnerId,
        repository_full_name: repository.fullName,
        allowed_refs: refs,
        verified_by: ownerUserId,
        verified_at: now,
      },
    })
  const deckCount = db.$count(
    decks,
    and(eq(decks.owner_user_id, ownerUserId), isNull(decks.deleted_at)),
  )
  // Drizzle's insert.select requires every column; this insert preserves omitted schema defaults.
  const createDeck = sql`
    INSERT INTO ${decks} (
      ${sql.identifier(decks.id.name)},
      ${sql.identifier(decks.slug.name)},
      ${sql.identifier(decks.owner_user_id.name)},
      ${sql.identifier(decks.created_at.name)}
    )
    SELECT ${newDeckId}, ${request.deck}, ${ownerUserId}, ${now}
    WHERE ${exists(liveSession)} AND ${deckCount} < ${deckLimit}
    ON CONFLICT DO NOTHING
  `
  // Drizzle 0.45.4's D1 batch cannot bind SQLiteRaw parameters.
  // inlineParams escapes the literals for the parameterless batch path.
  const [, upsert, authorization] = await db.batch([
    db.run(createDeck.inlineParams()),
    bind,
    liveSession,
  ])
  if (upsert.meta.changes > 0) return 'saved'
  if (authorization.length === 0) return 'session_expired'
  // Nothing was bound: the owner's deck is being deleted, or none was created.
  const existing = await db
    .select({ deletedAt: decks.deleted_at })
    .from(decks)
    .where(
      and(eq(decks.owner_user_id, ownerUserId), eq(decks.slug, request.deck)),
    )
    .get()
  return existing?.deletedAt != null ? 'deleting' : 'deck_limit'
}

const deckSummarySchema = repositoryBindingRowSchema.extend({
  allowed_refs: storedRefsSchema,
})

export async function listBindings(database: D1Database, ownerUserId: string) {
  const rows = await drizzle(database)
    .select({ binding: repositoryBindings, slug: decks.slug })
    .from(repositoryBindings)
    .innerJoin(decks, eq(decks.id, repositoryBindings.deck_id))
    .where(eq(decks.owner_user_id, ownerUserId))
    .orderBy(decks.slug)
    .all()
  return rows.map(({ binding: row, slug }) => {
    const binding = deckSummarySchema.parse(row)
    return {
      deck: deckSlugSchema.parse(slug),
      repository: binding.repository_full_name,
      repositoryId: binding.repository_id,
      allowedRefs: binding.allowed_refs,
      verifiedAt: binding.verified_at,
    }
  })
}

/**
 * Who owns a deck, for checking an upload against its owner on every
 * request. `deleted` is set while the deck waits to be purged. Null when
 * there is no such deck.
 */
export async function readDeckOwner(
  database: D1Database,
  deckId: string,
): Promise<Readonly<{
  ownerUserId: string
  slug: DeckSlug
  deleted: boolean
}> | null> {
  const row = await drizzle(database)
    .select({
      ownerUserId: decks.owner_user_id,
      slug: decks.slug,
      deletedAt: decks.deleted_at,
    })
    .from(decks)
    .where(eq(decks.id, deckId))
    .get()
  return row
    ? {
        ownerUserId: row.ownerUserId,
        slug: deckSlugSchema.parse(row.slug),
        deleted: row.deletedAt !== null,
      }
    : null
}

/**
 * The key of the owner's deck with this slug, or null. A slug is the
 * author's own name, so another author's deck of the same slug is not found
 * here, and a deck that is not there looks the same as one that is not yours.
 * `deleted` is set while the deck waits to be purged.
 */
export async function resolveDeck(
  database: D1Database,
  ownerUserId: string,
  slug: string,
): Promise<Readonly<{ id: DeckId; slug: DeckSlug; deleted: boolean }> | null> {
  const parsed = deckSlugSchema.safeParse(slug)
  if (!parsed.success) return null
  const row = await drizzle(database)
    .select({ id: decks.id, deletedAt: decks.deleted_at })
    .from(decks)
    .where(
      and(eq(decks.owner_user_id, ownerUserId), eq(decks.slug, parsed.data)),
    )
    .get()
  return row
    ? {
        id: deckIdSchema.parse(row.id),
        slug: parsed.data,
        deleted: row.deletedAt !== null,
      }
    : null
}

/**
 * Every slug the owner uses, including those of decks waiting to be purged:
 * their rows still hold the name.
 */
export async function readOwnerSlugs(
  database: D1Database,
  ownerUserId: string,
): Promise<ReadonlySet<string>> {
  const rows = await drizzle(database)
    .select({ slug: decks.slug })
    .from(decks)
    .where(eq(decks.owner_user_id, ownerUserId))
    .all()
  return new Set(rows.flatMap(({ slug }) => (slug === null ? [] : [slug])))
}

/** How many decks the owner has that are not waiting to be purged. */
export async function countLiveDecks(
  database: D1Database,
  ownerUserId: string,
): Promise<number> {
  return drizzle(database).$count(
    decks,
    and(eq(decks.owner_user_id, ownerUserId), isNull(decks.deleted_at)),
  )
}

/**
 * Whether readers were ever given this slide's URL: it is public now, was
 * published once, or is stopped with a version to come back to. Such a
 * slide keeps its URL name for good.
 */
const everPublished = sql`(${decks.first_published_at} IS NOT NULL
  OR ${decks.public_deployment_id} IS NOT NULL
  OR ${decks.resume_deployment_id} IS NOT NULL)`

/** Whether the owner may still change the slide's URL name. */
export async function canRenameDeck(
  database: D1Database,
  deckId: string,
): Promise<boolean> {
  const row = await drizzle(database)
    .select({ id: decks.id })
    .from(decks)
    .where(
      and(
        eq(decks.id, deckId),
        isNull(decks.deleted_at),
        sql`NOT ${everPublished}`,
      ),
    )
    .get()
  return row !== undefined
}

/** Whether a failed write, or what caused it, was a unique index refusing. */
function isUniqueViolation(error: unknown): boolean {
  for (let cause = error, depth = 0; cause && depth < 5; depth++) {
    if (/UNIQUE constraint failed/i.test(String(cause))) return true
    cause = (cause as { cause?: unknown }).cause
  }
  return false
}

export type RenameResult =
  | 'renamed'
  /** Another slide of the owner has the name. */
  | 'taken'
  /** Readers were given the URL once; it stays. */
  | 'published'
  /** No such slide of this owner, or it waits to be purged. */
  | 'missing'

/**
 * Changes the URL name of the owner's slide, but only while nobody was ever
 * given its URL. One conditional update: a publication that lands while the
 * author types wins, and the unique index refuses a name another start took
 * meanwhile.
 */
export async function renameDeck(
  database: D1Database,
  input: Readonly<{ ownerUserId: string; deckId: string; slug: DeckSlug }>,
): Promise<RenameResult> {
  const db = drizzle(database)
  const { ownerUserId, deckId, slug } = input
  const mine = and(eq(decks.id, deckId), eq(decks.owner_user_id, ownerUserId))
  let changed = 0
  try {
    const result = await db
      .update(decks)
      .set({ slug })
      .where(and(mine, isNull(decks.deleted_at), sql`NOT ${everPublished}`))
      .run()
    changed = result.meta.changes
  } catch (error) {
    // The only constraint a new slug can break is the owner's unique names.
    if (!isUniqueViolation(error)) throw error
    return 'taken'
  }
  if (changed > 0) return 'renamed'
  const row = await db
    .select({ deletedAt: decks.deleted_at })
    .from(decks)
    .where(mine)
    .get()
  return row && row.deletedAt === null ? 'published' : 'missing'
}
