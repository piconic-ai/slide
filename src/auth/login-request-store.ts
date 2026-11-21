import { and, eq, gt } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { drizzle } from 'drizzle-orm/d1'
import { loginCodeRequests } from '../db/schema'

export type KeyPair = Readonly<{ addressHash: string; sourceHash: string }>
export type RequestKind = 'send' | 'attempt'

const NO_LIMIT = 1_000_000_000

/** When this address and this client asked inside the window. */
export async function readRequests(
  database: D1Database,
  kind: RequestKind,
  keys: KeyPair,
  since: number,
): Promise<{ address: number[]; source: number[] }> {
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
  const [address, source] = await Promise.all([
    of(loginCodeRequests.address_hash, keys.addressHash),
    of(loginCodeRequests.source_hash, keys.sourceHash),
  ])
  return {
    address: address.map((row) => row.at),
    source: source.map((row) => row.at),
  }
}

/**
 * Records one request only if both counts are under their limits, in one
 * statement: the count and the insert cannot be split by another request, so
 * parallel requests cannot pass the limit together. Returns whether it was
 * recorded. Rows older than the window, and expired codes, are removed in the
 * same batch. `perSource` null means the client is not limited.
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
  }>,
): Promise<boolean> {
  const { kind, keys, now, windowSeconds } = input
  const since = now - windowSeconds
  const count = (column: 'address_hash' | 'source_hash') =>
    `(SELECT count(*) FROM login_code_requests
      WHERE kind = ?1 AND ${column} = ?${column === 'address_hash' ? 2 : 3} AND requested_at > ?4)`
  const [, inserted] = await database.batch([
    database
      .prepare('DELETE FROM login_code_requests WHERE requested_at <= ?1')
      .bind(since),
    database
      .prepare(
        `INSERT INTO login_code_requests
          (id, kind, address_hash, source_hash, requested_at)
        SELECT ?5, ?1, ?2, ?3, ?6
        WHERE ${count('address_hash')} < ?7 AND ${count('source_hash')} < ?8`,
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
      ),
    // Codes that ran out are no use to anyone, and nothing else removes them.
    database
      .prepare('DELETE FROM auth_verification WHERE expires_at < ?1')
      .bind(now * 1000),
  ])
  return (inserted?.meta.changes ?? 0) > 0
}
