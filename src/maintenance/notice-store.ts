import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { maintenanceNotice, maintenanceNoticeRowSchema } from '../db/schema'
import type { MaintenanceNotice } from './notice'

/** The one row's key: there is never a second plan (F38-AC6). */
const ROW = 1

/**
 * The plan that is stored, or null when there is none or the row cannot be
 * read as a plan. A row that fails its schema is a stored value that is not
 * trusted, so it is shown as no band rather than a wrong one.
 */
export async function readNotice(
  database: D1Database,
): Promise<MaintenanceNotice | null> {
  const [row] = await drizzle(database)
    .select()
    .from(maintenanceNotice)
    .where(eq(maintenanceNotice.id, ROW))
    .limit(1)
  const parsed = maintenanceNoticeRowSchema.safeParse(row)
  return parsed.success
    ? {
        startsAt: parsed.data.starts_at,
        endsAt: parsed.data.ends_at,
        reason: parsed.data.reason,
      }
    : null
}

/** Puts the plan in, replacing the one before it (F38-AC6), in one statement. */
export async function saveNotice(
  database: D1Database,
  notice: MaintenanceNotice,
  now: number,
): Promise<void> {
  await drizzle(database)
    .insert(maintenanceNotice)
    .values({
      id: ROW,
      starts_at: notice.startsAt,
      ends_at: notice.endsAt,
      reason: notice.reason,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: maintenanceNotice.id,
      set: {
        starts_at: sql`excluded.starts_at`,
        ends_at: sql`excluded.ends_at`,
        reason: sql`excluded.reason`,
        updated_at: sql`excluded.updated_at`,
      },
    })
}

/** Removes the plan (F38-AC5). True when there was one. */
export async function clearNotice(database: D1Database): Promise<boolean> {
  const result = await drizzle(database)
    .delete(maintenanceNotice)
    .where(eq(maintenanceNotice.id, ROW))
  return result.meta.changes > 0
}
