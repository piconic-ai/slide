import { desc } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { signupPauseEvents } from '../db/schema'

/** What the operator last did with new sign-ups, and when. */
export type SignupPause =
  | Readonly<{ kind: 'running' }>
  | Readonly<{ kind: 'paused'; since: number }>

/**
 * Whether new sign-ups are stopped: the newest row of the operator's presses
 * says so. With no row, they are not. One indexed read of one row, so it can
 * be asked on every login request (F42-AC12).
 */
export async function readSignupPause(
  database: D1Database,
): Promise<SignupPause> {
  const row = await drizzle(database)
    .select({
      paused: signupPauseEvents.paused,
      at: signupPauseEvents.changed_at,
    })
    .from(signupPauseEvents)
    .orderBy(desc(signupPauseEvents.id))
    .limit(1)
    .get()
  return row?.paused ? { kind: 'paused', since: row.at } : { kind: 'running' }
}

/**
 * Stops new sign-ups, or lets them go on (F42-AC12, F42-AC15), and keeps the
 * press with who made it. The row is added only when the state would change,
 * in the same statement that reads the state, so pressing twice, or two
 * operators pressing together, leaves one row and the same state.
 */
export async function setSignupPause(
  database: D1Database,
  input: Readonly<{ paused: boolean; by: string; now: number }>,
): Promise<'changed' | 'unchanged'> {
  const result = await database
    .prepare(
      `INSERT INTO signup_pause_events (paused, changed_at, changed_by)
        SELECT ?1, ?2, ?3
        WHERE coalesce(
          (SELECT paused FROM signup_pause_events ORDER BY id DESC LIMIT 1), 0
        ) <> ?1`,
    )
    .bind(input.paused ? 1 : 0, input.now, input.by)
    .run()
  return result.meta.changes > 0 ? 'changed' : 'unchanged'
}
