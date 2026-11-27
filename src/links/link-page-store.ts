/**
 * What the page of links of an address reads from D1 (F45). For now only
 * the event an address stands for; the other links come with their columns.
 */
import { eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { events, lumaEventAliases } from '../db/schema'

/**
 * The events kept under the keys, in the order of the keys. The keys are
 * the ways one address may have been kept (`eventKeysOf`).
 */
export async function findEventIdsByKey(
  database: D1Database,
  keys: readonly string[],
): Promise<readonly number[]> {
  if (keys.length === 0) return []
  const rows = await drizzle(database)
    .select({ id: events.id, key: events.key })
    .from(events)
    .where(inArray(events.key, [...keys]))
    .all()
  const byKey = new Map(rows.map((row) => [row.key, row.id]))
  return keys.map((key) => byKey.get(key)).filter((id) => id !== undefined)
}

/**
 * The key of the name a calendar's feed paired with a Luma id key
 * (F33-AC20), or null when no feed told it.
 */
export async function findAliasedKey(
  database: D1Database,
  key: string,
): Promise<string | null> {
  const row = await drizzle(database)
    .select({ key: lumaEventAliases.event_key })
    .from(lumaEventAliases)
    .where(eq(lumaEventAliases.alias_key, key))
    .get()
  return row?.key ?? null
}
