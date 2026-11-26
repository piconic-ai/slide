/**
 * The two addresses of one Luma event (F33-AC20): the id key a calendar's
 * feed pairs with the name key of the same event, and the events of the two
 * made one. Only keys are kept (D-60).
 */
import type { LumaAlias } from './ical'

/**
 * Keeps the pairs a feed lists, then makes the events of each pair one. A
 * pair kept from before stays as it was: an id names one event for good.
 */
export async function addEventAliases(
  database: D1Database,
  aliases: readonly LumaAlias[],
  now: number,
): Promise<void> {
  if (aliases.length === 0) return
  await database.batch(
    aliases.map(({ aliasKey, eventKey }) =>
      database
        .prepare(
          `INSERT INTO luma_event_aliases (alias_key, event_key, added_at)
          VALUES (?1, ?2, ?3) ON CONFLICT (alias_key) DO NOTHING`,
        )
        .bind(aliasKey, eventKey, now),
    ) as [D1PreparedStatement, ...D1PreparedStatement[]],
  )
  await joinAliasedEvent(
    database,
    aliases.map((alias) => alias.aliasKey),
  )
}

const NAME_KEY_PREFIX = 'https://luma.com/'

/**
 * Makes the event of each paired id key one with the event of its name key.
 * When only the id's event is there, it takes the name's key, address and
 * ref, and keeps its number and its links. When both are there, the id's
 * links move to the name's event, which takes the id's name while it has
 * none; the id's event is left with no talk, so its page is not found
 * (F29-AC12). An id key no feed paired is left alone.
 */
export async function joinAliasedEvent(
  database: D1Database,
  aliasKeys: readonly string[],
): Promise<void> {
  const unique = [...new Set(aliasKeys)]
  if (unique.length === 0) return
  const pair = `(SELECT event_key FROM luma_event_aliases WHERE alias_key = ?1)`
  const statements = unique.flatMap((aliasKey) => [
    database
      .prepare(
        `UPDATE events SET name = (SELECT name FROM events WHERE key = ?1)
        WHERE key = ${pair} AND name IS NULL AND named_by IS NULL`,
      )
      .bind(aliasKey),
    database
      .prepare(
        `UPDATE related_link_events
        SET event_id = (SELECT id FROM events WHERE key = ${pair})
        WHERE event_id = (SELECT id FROM events WHERE key = ?1)
          AND EXISTS (SELECT 1 FROM events WHERE key = ${pair})`,
      )
      .bind(aliasKey),
    database
      .prepare(
        `UPDATE events
        SET key = ${pair}, url = ${pair},
          ref = substr(${pair}, length(?2) + 1)
        WHERE key = ?1 AND ${pair} IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM events WHERE key = ${pair})`,
      )
      .bind(aliasKey, NAME_KEY_PREFIX),
  ])
  await database.batch(
    statements as [D1PreparedStatement, ...D1PreparedStatement[]],
  )
}
