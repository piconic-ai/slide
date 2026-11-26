import { and, asc, eq, gt, isNull, lte, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { backupObjects, backupState } from '../db/schema'
import { isBackedUp } from './keys'
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

/** Notes that a run happened, and how many objects failed in it. */
export async function finishRun(
  database: D1Database,
  run: Readonly<{ at: number; failed: number }>,
) {
  await drizzle(database)
    .update(backupState)
    .set({
      last_run_at: run.at,
      last_run_failed: run.failed,
      last_failed_at: sql`CASE WHEN ${run.failed} > 0 THEN ${run.at} ELSE ${backupState.last_failed_at} END`,
    })
    .where(eq(backupState.id, 1))
    .run()
}
