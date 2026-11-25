import { and, eq, not, sql, type SQL } from 'drizzle-orm'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import { handles, releasedHandles, type HANDLE_OWNER_KINDS } from '../db/schema'
import { handleSchema, type Handle } from '../share/handle'
import { heldSince } from './hold'

export type HandleOwnerKind = (typeof HANDLE_OWNER_KINDS)[number]

/** Who holds a handle: a person (their user id) or a community (its id). */
export type HandleOwner = Readonly<{ kind: HandleOwnerKind; id: string }>

/**
 * The SQL condition that `owner` holds `handle`. The rows `takeHandle` writes
 * after the claim carry it, so they write nothing when the claim wrote
 * nothing.
 */
export const ownsHandle = (handle: Handle, owner: HandleOwner): SQL =>
  sql`EXISTS (SELECT 1 FROM ${handles} WHERE ${handles.handle} = ${handle}
    AND ${handles.owner_kind} = ${owner.kind} AND ${handles.owner_id} = ${owner.id})`

export type HandleAvailability = 'available' | 'taken' | 'held'

const heldAt = (handle: Handle, now: number): SQL =>
  sql`EXISTS (SELECT 1 FROM ${releasedHandles}
    WHERE ${releasedHandles.handle} = ${handle}
      AND ${releasedHandles.released_at} > ${heldSince(now)})`

/**
 * Whether a handle is free at `now`: nobody holds it and it was not let go
 * of in the last 90 days. A check before taking it, to tell the person why;
 * only `takeHandle` decides who gets it.
 */
export async function handleAvailability(
  database: D1Database,
  handle: Handle,
  now: number,
): Promise<HandleAvailability> {
  const row = await drizzle(database).get<{ taken: number; held: number }>(
    sql`SELECT EXISTS (SELECT 1 FROM ${handles} WHERE ${handles.handle} = ${handle}) AS taken,
      ${heldAt(handle, now)} AS held`,
  )
  if (row?.taken) return 'taken'
  return row?.held ? 'held' : 'available'
}

const dialect = new SQLiteSyncDialect()

/** A drizzle SQL statement as a D1 one, its values bound. */
const statementOf = (database: D1Database) => (query: SQL) => {
  const { sql: text, params } = dialect.sqlToQuery(query)
  return database.prepare(text).bind(...params)
}

export type TakeHandleResult = 'claimed' | HandleAvailability

/**
 * The one way to take a handle, for a person signing up and for a new
 * community alike. In one batch, it writes the handle for the owner unless
 * the handle was let go of in the last 90 days or `precondition` fails, then
 * runs `rest`: SQL statements writing the owner's own rows, each guarded by
 * `ownsHandle`. Two
 * owners taking one handle at once meet the primary key, and the later
 * batch is undone whole. The result is `claimed`, or why not: `taken`,
 * `held`, or `available` when the precondition failed.
 */
export async function takeHandle(
  database: D1Database,
  input: Readonly<{
    handle: Handle
    owner: HandleOwner
    now: number
    precondition?: SQL
    rest: readonly SQL[]
  }>,
): Promise<TakeHandleResult> {
  const { handle, owner, now } = input
  const db = drizzle(database)
  const claim = sql`INSERT INTO ${handles} (handle, owner_kind, owner_id, created_at)
    SELECT ${handle}, ${owner.kind}, ${owner.id}, ${now}
    WHERE NOT ${heldAt(handle, now)} AND (${input.precondition ?? sql`1`})`
  let failure: unknown = null
  try {
    await database.batch([claim, ...input.rest].map(statementOf(database)))
  } catch (error) {
    failure = error
  }
  const held = await db
    .select({ handle: handles.handle })
    .from(handles)
    .where(ownedBy(owner))
    .get()
  if (held?.handle === handle) return 'claimed'
  const availability = await handleAvailability(database, handle, now)
  // Only the handle's key can fail a valid claim; anything else is not ours
  // to hide.
  if (failure !== null && availability === 'available') throw failure
  return availability
}

const ownedBy = (owner: HandleOwner) =>
  and(eq(handles.owner_kind, owner.kind), eq(handles.owner_id, owner.id))

/**
 * The statements that let an owner's handle go, for the caller's batch
 * (leaving, deleting a community): the handle is kept as let go of `now`,
 * so nobody takes it for 90 days, and no longer held.
 */
export function releaseHandleSteps(
  db: DrizzleD1Database,
  input: Readonly<{ owner: HandleOwner; now: number }>,
) {
  const { owner, now } = input
  return [
    db
      .insert(releasedHandles)
      .select(
        db
          .select({
            handle: handles.handle,
            released_at: sql<number>`${now}`.as('released_at'),
            moved_to_kind: sql<null>`NULL`.as('moved_to_kind'),
            moved_to_id: sql<null>`NULL`.as('moved_to_id'),
          })
          .from(handles)
          .where(ownedBy(owner)),
      )
      .onConflictDoUpdate({
        target: releasedHandles.handle,
        set: {
          released_at: sql`excluded.released_at`,
          moved_to_kind: null,
          moved_to_id: null,
        },
      }),
    db.delete(handles).where(ownedBy(owner)),
  ] as const
}

/** The handle an owner holds, or null when they hold none. */
export async function readOwnerHandle(
  database: D1Database,
  owner: HandleOwner,
): Promise<Handle | null> {
  const row = await drizzle(database)
    .select({ handle: handles.handle })
    .from(handles)
    .where(ownedBy(owner))
    .get()
  return row ? handleSchema.parse(row.handle) : null
}
