import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { staleSignups, type SignupUser } from './signup-sweep'

/** The rows a person's sign-in made for a code: Better Auth's identifier. */
const CODE_IDENTIFIER = `'sign-in-otp-' || (SELECT email FROM auth_user WHERE id = ?1)`

/**
 * Removes what a first sign-in left of one person: their code, their
 * sessions and their user row (which holds the address). Only a person who
 * has no account is touched, so this never ends a real account (that is
 * leaving the service, which deletes much more). A suspended person's user
 * row stays, as F17-AC30 needs, but their sessions and code go. The
 * operator's invitation and the hashed request log are not touched.
 */
export async function leaveBeforeSignup(
  database: D1Database,
  userId: string,
): Promise<void> {
  const noAccount = `NOT EXISTS (SELECT 1 FROM accounts WHERE user_id = ?1)`
  await database.batch([
    database
      .prepare(
        `DELETE FROM auth_verification WHERE identifier = ${CODE_IDENTIFIER} AND ${noAccount}`,
      )
      .bind(userId),
    database
      .prepare(`DELETE FROM auth_session WHERE user_id = ?1 AND ${noAccount}`)
      .bind(userId),
    database
      .prepare(
        `DELETE FROM auth_user WHERE id = ?1 AND ${noAccount}
          AND NOT EXISTS (SELECT 1 FROM suspensions WHERE user_id = ?1)`,
      )
      .bind(userId),
  ])
}

type Row = {
  id: string
  last_sign_in: number
  has_account: number
  suspended: number
}

/** Every user who has no account yet, with when they were made. */
async function readUnfinished(database: D1Database): Promise<SignupUser[]> {
  const rows = await drizzle(database).all<Row>(sql`
    SELECT u.id AS id,
      max(u.created_at, u.updated_at,
        coalesce((SELECT max(max(s.created_at, s.updated_at))
          FROM auth_session s WHERE s.user_id = u.id), 0)) AS last_sign_in,
      0 AS has_account,
      EXISTS (SELECT 1 FROM suspensions s WHERE s.user_id = u.id) AS suspended
    FROM auth_user u
    WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.user_id = u.id)`)
  return rows.map((row) => ({
    id: row.id,
    // These columns are milliseconds.
    lastSignInAt: Math.floor(row.last_sign_in / 1000),
    hasAccount: row.has_account === 1,
    suspended: row.suspended === 1,
  }))
}

export type SignupSweep = Readonly<{
  users: number
  codes: number
  /** Sessions past their end, of anyone (F28-AC104). */
  sessions: number
}>

/**
 * The hourly sweep: codes and sessions that ran out, and the records of people whose last
 * sign-in was a day ago and who never made an account (at most `SWEEP_LIMIT`
 * of them per run). Each is deleted through
 * the same guarded statements as leaving, so a person who made an account
 * since the read is not touched.
 */
export async function sweepSignups(
  database: D1Database,
  now: number,
): Promise<SignupSweep> {
  const expired = await database
    .prepare('DELETE FROM auth_verification WHERE expires_at < ?1')
    .bind(now * 1000)
    .run()
  // A device left unused past its end never sends its cookie again, so its
  // row would stay for good; only the rough device name and times are in it.
  const ended = await database
    .prepare('DELETE FROM auth_session WHERE expires_at < ?1')
    .bind(now * 1000)
    .run()
  const stale = staleSignups(await readUnfinished(database), now)
  for (const id of stale) await leaveBeforeSignup(database, id)
  return {
    users: stale.length,
    codes: expired.meta.changes,
    sessions: ended.meta.changes,
  }
}
