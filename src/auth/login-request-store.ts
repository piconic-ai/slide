import { and, count, desc, eq, gt } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { drizzle } from 'drizzle-orm/d1'
import { loginCodeRequests } from '../db/schema'

export type KeyPair = Readonly<{ addressHash: string; sourceHash: string }>
export type RequestKind = 'send' | 'attempt'

const NO_LIMIT = 1_000_000_000

/**
 * When this address and this client asked inside the window, and when
 * anyone did: of those, only the newest `newest` times, which are all the
 * total cap needs to say when it lets go. `newest` null means the total cap is
 * off: everyone's requests are not read, and `total` is empty.
 */
export async function readRequests(
  database: D1Database,
  kind: RequestKind,
  keys: KeyPair,
  since: number,
  newest: number | null,
): Promise<{ address: number[]; source: number[]; total: number[] }> {
  const db = drizzle(database)
  const of = (column: AnySQLiteColumn, hash: string) =>
    db
      .select({ at: loginCodeRequests.requested_at })
      .from(loginCodeRequests)
      .where(
        and(
          eq(loginCodeRequests.kind, kind),
          eq(column, hash),
          gt(loginCodeRequests.requested_at, since),
        ),
      )
  const [address, source, total] = await Promise.all([
    of(loginCodeRequests.address_hash, keys.addressHash),
    of(loginCodeRequests.source_hash, keys.sourceHash),
    newest === null
      ? Promise.resolve([])
      : db
          .select({ at: loginCodeRequests.requested_at })
          .from(loginCodeRequests)
          .where(
            and(
              eq(loginCodeRequests.kind, kind),
              gt(loginCodeRequests.requested_at, since),
            ),
          )
          .orderBy(desc(loginCodeRequests.requested_at))
          .limit(newest),
  ])
  return {
    address: address.map((row) => row.at),
    source: source.map((row) => row.at),
    total: total.map((row) => row.at),
  }
}

/** How many requests of a kind from anyone were recorded after `since`. */
export async function countRequests(
  database: D1Database,
  kind: RequestKind,
  since: number,
): Promise<number> {
  const [row] = await drizzle(database)
    .select({ n: count() })
    .from(loginCodeRequests)
    .where(
      and(
        eq(loginCodeRequests.kind, kind),
        gt(loginCodeRequests.requested_at, since),
      ),
    )
  return row?.n ?? 0
}

/**
 * Records one request only if both counts are under their limits, in one
 * statement: the count and the insert cannot be split by another request, so
 * parallel requests cannot pass the limit together. Returns whether it was
 * recorded. Rows older than the window, and expired codes, are removed in the
 * same batch. `perSource` and `perTotal` null mean the client, or everyone
 * together, is not limited (the total is then not counted at all).
 */
export async function tryRecordRequest(
  database: D1Database,
  input: Readonly<{
    kind: RequestKind
    keys: KeyPair
    now: number
    windowSeconds: number
    perAddress: number
    perSource: number | null
    perTotal: number | null
  }>,
): Promise<boolean> {
  const { kind, keys, now, windowSeconds } = input
  const since = now - windowSeconds
  const countOf = (column: 'address_hash' | 'source_hash') =>
    `(SELECT count(*) FROM login_code_requests
      WHERE kind = ?1 AND ${column} = ?${column === 'address_hash' ? 2 : 3} AND requested_at > ?4)`
  // Everyone's requests of the kind: the cap on the service's total. Left out
  // of the statement when the cap is off, so that no count over the whole
  // table is paid for a limit nobody set.
  const countAll = `AND (SELECT count(*) FROM login_code_requests
      WHERE kind = ?1 AND requested_at > ?4) < ?9`
  const [, inserted] = await database.batch([
    database
      .prepare('DELETE FROM login_code_requests WHERE requested_at <= ?1')
      .bind(since),
    database
      .prepare(
        `INSERT INTO login_code_requests
          (id, kind, address_hash, source_hash, requested_at)
        SELECT ?5, ?1, ?2, ?3, ?6
        WHERE ${countOf('address_hash')} < ?7 AND ${countOf('source_hash')} < ?8
          ${input.perTotal === null ? '' : countAll}`,
      )
      .bind(
        kind,
        keys.addressHash,
        keys.sourceHash,
        since,
        crypto.randomUUID(),
        now,
        input.perAddress,
        input.perSource ?? NO_LIMIT,
        // ?9 exists only when the total cap does, so the binding follows the
        // statement's placeholders.
        ...(input.perTotal === null ? [] : [input.perTotal]),
      ),
    // Codes that ran out are no use to anyone, and nothing else removes them.
    database
      .prepare('DELETE FROM auth_verification WHERE expires_at < ?1')
      .bind(now * 1000),
  ])
  return (inserted?.meta.changes ?? 0) > 0
}
