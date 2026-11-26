/**
 * The two addresses of one Luma event (F33-AC20): the id key a calendar's
 * feed pairs with the name key of the same event, and the events of the two
 * made one. Only keys are kept (D-60).
 */
import { drizzle } from 'drizzle-orm/d1'
import { lumaEventAliases } from '../db/schema'
import type { LumaAlias } from './ical'

// D1 binds at most 100 values a statement; a row takes three.
const ALIAS_ROWS_PER_INSERT = 30

/**
 * Keeps the pairs a feed lists, then makes the events of every pair one. A
 * pair kept from before stays as it was: an id names one event for good.
 */
export async function addEventAliases(
  database: D1Database,
  aliases: readonly LumaAlias[],
  now: number,
): Promise<void> {
  if (aliases.length === 0) return
  const db = drizzle(database)
  for (let start = 0; start < aliases.length; start += ALIAS_ROWS_PER_INSERT)
    await db
      .insert(lumaEventAliases)
      .values(
        aliases
          .slice(start, start + ALIAS_ROWS_PER_INSERT)
          .map(({ aliasKey, eventKey }) => ({
            alias_key: aliasKey,
            event_key: eventKey,
            added_at: now,
          })),
      )
      .onConflictDoNothing()
  await joinAliasedEvents(database)
}

// The event of an id key and the event of the name key it is paired with.
const PAIRED = `luma_event_aliases a
  JOIN events id_event ON id_event.key = a.alias_key
  JOIN events name_event ON name_event.key = a.event_key`

/**
 * Makes the event of every paired id key one with the event of its name
 * key, in a few statements however many pairs there are. When only the
 * id's event is there, it takes the name's key, address and ref, and keeps
 * its number, its links and its name. When both are there, the id's links
 * move to the name's event, which takes the id's name while it has none
 * (and no operator named it); the id's event is left with no talk, so its
 * page is not found (F29-AC12). An id key no feed paired is left alone.
 */
export async function joinAliasedEvents(database: D1Database): Promise<void> {
  const moveLinks = database.prepare(
    `UPDATE related_link_events
    SET event_id = (SELECT name_event.id FROM ${PAIRED}
      WHERE id_event.id = related_link_events.event_id)
    WHERE event_id IN (SELECT id_event.id FROM ${PAIRED})`,
  )
  await database.batch([
    database.prepare(
      `UPDATE events
      SET name = (SELECT id_event.name FROM ${PAIRED}
        WHERE name_event.id = events.id AND id_event.name IS NOT NULL
        ORDER BY id_event.id LIMIT 1)
      WHERE name IS NULL AND named_by IS NULL
        AND id IN (SELECT name_event.id FROM ${PAIRED}
          WHERE id_event.name IS NOT NULL)`,
    ),
    moveLinks,
    // One id event a name takes; should a name have two, the other one's
    // links move to it by the statement after.
    database.prepare(
      `UPDATE events
      SET key = (SELECT event_key FROM luma_event_aliases WHERE alias_key = events.key),
        url = (SELECT event_key FROM luma_event_aliases WHERE alias_key = events.key),
        ref = substr(
          (SELECT event_key FROM luma_event_aliases WHERE alias_key = events.key),
          length('https://luma.com/') + 1),
        service = 'luma'
      WHERE id IN (
        SELECT min(e.id) FROM luma_event_aliases a
        JOIN events e ON e.key = a.alias_key
        WHERE NOT EXISTS (SELECT 1 FROM events n WHERE n.key = a.event_key)
        GROUP BY a.event_key)`,
    ),
    moveLinks,
  ])
}
