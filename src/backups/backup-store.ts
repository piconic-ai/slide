import {
  and,
  asc,
  count,
  eq,
  gt,
  gte,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  sql,
} from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { backupObjects, backupState } from '../db/schema'
import { isBackedUp } from './keys'
import { expiryCutoff } from './limits'
import type { SourceObject, TrackedObject } from './page-plan'
import { parseState, type BackupState } from './run-plan'

/** One page of the source, in key order. */
export type SourcePage = Readonly<{
  /** The objects of the page that are backed up. */
  objects: readonly SourceObject[]
  /** The last key listed, whether it is backed up or not; null for an empty page. */
  lastKey: string | null
  /** Whether keys come after this page. */
  truncated: boolean
}>

/**
 * Lists up to `limit` keys of the source after `after`, in key order. The
 * place to go on from is a key, not a cursor R2 hands out, so that it can
 * be kept in D1 and used a day later.
 */
export async function listSourcePage(
  source: R2Bucket,
  after: string | null,
  limit: number,
): Promise<SourcePage> {
  const listed = await source.list({
    limit,
    ...(after === null ? {} : { startAfter: after }),
  })
  return {
    objects: listed.objects
      .filter(({ key }) => isBackedUp(key))
      .map(({ key, etag, size }) => ({ key, etag, size })),
    lastKey: listed.objects.at(-1)?.key ?? null,
    truncated: listed.truncated,
  }
}

/** How a copy ended. `changed` is an object put again, or gone, since it was listed. */
export type CopyResult = 'copied' | 'changed'

/**
 * Copies one object to the backup under the same key, with its type and
 * metadata. The read is conditional on the etag that was listed, so a
 * source that was put again meanwhile is left for the next pass and not
 * copied half old, half new. R2 checks the bytes against the source's
 * checksum as it writes (SHA-256 where the source kept one, MD5 otherwise),
 * and a write of another size is taken back. Throws on any failure.
 */
export async function copyObject(
  source: R2Bucket,
  backup: R2Bucket,
  object: SourceObject,
): Promise<CopyResult> {
  const read = await source.get(object.key, {
    onlyIf: { etagMatches: object.etag },
  })
  if (!read || !('body' in read)) return 'changed'
  const { sha256, md5 } = read.checksums
  const hash = sha256 ? { sha256 } : md5 ? { md5 } : {}
  const written = await backup.put(object.key, read.body, {
    httpMetadata: read.httpMetadata,
    customMetadata: read.customMetadata,
    ...hash,
  })
  if (written.size !== read.size) {
    await backup.delete(object.key)
    throw new RangeError('The copy is not the size of its source')
  }
  return 'copied'
}

/** The state row. */
export async function readState(database: D1Database): Promise<BackupState> {
  const row = await drizzle(database)
    .select()
    .from(backupState)
    .where(eq(backupState.id, 1))
    .get()
  if (!row) throw new RangeError('backup_state has no row')
  return parseState(row)
}

/** Starts a pass at `at`, from the first key. */
export async function startPass(database: D1Database, at: number) {
  await drizzle(database)
    .update(backupState)
    .set({ pass_started_at: at, cursor: null, last_pass_started_at: at })
    .where(eq(backupState.id, 1))
    .run()
}

/**
 * The backup's rows from the key after `after` (from the first, for null) to
 * `upTo` (to the last, for null), in key order.
 */
export async function readTracked(
  database: D1Database,
  after: string | null,
  upTo: string | null,
): Promise<TrackedObject[]> {
  const rows = await drizzle(database)
    .select({
      key: backupObjects.key,
      etag: backupObjects.etag,
      goneAt: backupObjects.gone_at,
    })
    .from(backupObjects)
    .where(
      and(
        after === null ? undefined : gt(backupObjects.key, after),
        upTo === null ? undefined : lte(backupObjects.key, upTo),
      ),
    )
    .orderBy(asc(backupObjects.key))
    .all()
  return rows
}

/** What a page leaves in D1, written in one batch with the cursor's move. */
export type PageCommit = Readonly<{
  at: number
  copied: readonly SourceObject[]
  revive: readonly string[]
  gone: readonly string[]
  /**
   * Where the pass is after this page: past `key`, finished, or where it was
   * (a page given up on keeps its copies and not its place).
   */
  next: Readonly<
    { kind: 'cursor'; key: string } | { kind: 'complete' } | { kind: 'stay' }
  >
}>

function moveCursor(
  db: ReturnType<typeof drizzle>,
  next: PageCommit['next'],
  at: number,
) {
  const where = eq(backupState.id, 1)
  switch (next.kind) {
    case 'stay':
      return []
    case 'cursor':
      return [
        db
          .update(backupState)
          .set({ cursor: next.key, progress_at: at })
          .where(where),
      ]
    case 'complete':
      return [
        db
          .update(backupState)
          .set({
            pass_started_at: null,
            cursor: null,
            last_completed_at: at,
            progress_at: at,
          })
          .where(where),
      ]
  }
}

/**
 * Records a page: the copies made, the sources that came back or went, and
 * the cursor, together, so that a stop between two pages leaves the cursor
 * exactly where the records end.
 */
export async function commitPage(database: D1Database, commit: PageCommit) {
  const db = drizzle(database)
  const { at } = commit
  const statements = [
    ...commit.copied.map((object) =>
      db
        .insert(backupObjects)
        .values({
          key: object.key,
          etag: object.etag,
          size: object.size,
          copied_at: at,
          gone_at: null,
        })
        .onConflictDoUpdate({
          target: backupObjects.key,
          set: {
            etag: object.etag,
            size: object.size,
            copied_at: at,
            gone_at: null,
          },
        }),
    ),
    ...commit.revive.map((key) =>
      db
        .update(backupObjects)
        .set({ gone_at: null })
        .where(eq(backupObjects.key, key)),
    ),
    ...commit.gone.map((key) =>
      db
        .update(backupObjects)
        .set({ gone_at: at })
        .where(and(eq(backupObjects.key, key), isNull(backupObjects.gone_at))),
    ),
    ...moveCursor(db, commit.next, at),
  ]
  const [first, ...rest] = statements
  if (first) await db.batch([first, ...rest])
}

/**
 * Deletes the copies whose source was found gone more than 30 days before
 * `at`, at most `limit` of them: the copies in the backup bucket first, then
 * their rows, so that a stop between the two leaves rows that the next run
 * deletes again. A copy whose source is there (`gone_at` empty) is never
 * touched (F39-AC27, F39-AC28). Answers how many.
 */
export async function expireCopies(
  stores: Readonly<{ database: D1Database; backup: R2Bucket }>,
  at: number,
  limit: number,
): Promise<number> {
  const db = drizzle(stores.database)
  const cutoff = expiryCutoff(at)
  const rows = await db
    .select({ key: backupObjects.key })
    .from(backupObjects)
    .where(
      and(isNotNull(backupObjects.gone_at), lt(backupObjects.gone_at, cutoff)),
    )
    .orderBy(asc(backupObjects.gone_at))
    .limit(limit)
    .all()
  const [first, ...rest] = rows.map(({ key }) =>
    db
      .delete(backupObjects)
      .where(
        and(
          eq(backupObjects.key, key),
          isNotNull(backupObjects.gone_at),
          lt(backupObjects.gone_at, cutoff),
        ),
      ),
  )
  if (!first) return 0
  await stores.backup.delete(rows.map(({ key }) => key))
  await db.batch([first, ...rest])
  return rows.length
}

/**
 * Notes that a run happened, how many objects failed in it, and whether it
 * was told to the operator.
 */
export async function finishRun(
  database: D1Database,
  run: Readonly<{ at: number; failed: number; told: boolean }>,
) {
  await drizzle(database)
    .update(backupState)
    .set({
      last_run_at: run.at,
      last_run_failed: run.failed,
      last_failed_at: sql`CASE WHEN ${run.failed} > 0 THEN ${run.at} ELSE ${backupState.last_failed_at} END`,
      told_at: sql`CASE WHEN ${run.told ? 1 : 0} = 1 THEN ${run.at} ELSE ${backupState.told_at} END`,
    })
    .where(eq(backupState.id, 1))
    .run()
}

/** What the operations page shows of the backup bucket's records. */
export type BackupCounts = Readonly<{
  lastCopiedAt: number | null
  /** Copies made since the latest pass started. */
  copiedInLastPass: number
  /** Copies whose source is there. */
  kept: number
  /** Copies whose source is gone, kept for their 30 days. */
  keptAfterDeletion: number
}>

/** The counts of the backup's records, given when the latest pass started. */
export async function readCounts(
  database: D1Database,
  lastPassStartedAt: number | null,
): Promise<BackupCounts> {
  const db = drizzle(database)
  const [totals, since] = await Promise.all([
    db
      .select({
        lastCopiedAt: max(backupObjects.copied_at),
        kept: count(sql`CASE WHEN ${backupObjects.gone_at} IS NULL THEN 1 END`),
        keptAfterDeletion: count(
          sql`CASE WHEN ${backupObjects.gone_at} IS NOT NULL THEN 1 END`,
        ),
      })
      .from(backupObjects)
      .get(),
    lastPassStartedAt === null
      ? Promise.resolve({ n: 0 })
      : db
          .select({ n: count() })
          .from(backupObjects)
          .where(gte(backupObjects.copied_at, lastPassStartedAt))
          .get(),
  ])
  return {
    lastCopiedAt: totals?.lastCopiedAt ?? null,
    copiedInLastPass: since?.n ?? 0,
    kept: totals?.kept ?? 0,
    keptAfterDeletion: totals?.keptAfterDeletion ?? 0,
  }
}
