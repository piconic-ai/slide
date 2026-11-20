import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { authAccount } from '../db/auth-schema'
import { profiles } from '../db/schema'
import { avatarUrlOf, bioOf, websiteOf, type Profile } from './github-profile'

export type SyncedProfile = Profile &
  Readonly<{ hasSponsors: boolean; syncedAt: number }>

/**
 * Replaces the author's profile with what GitHub answered at this sign-in.
 * `hasSponsors` is null when GitHub did not say; the last known answer then
 * stays, and a first sync starts without the link.
 *
 * Nothing is kept unless the author's GitHub account is still signed up, in
 * the same statement: an author who leaves while a sign-in is finishing must
 * not get their profile back.
 */
export async function saveProfile(
  database: D1Database,
  userId: string,
  profile: Profile,
  hasSponsors: boolean | null,
  now: number,
): Promise<void> {
  await drizzle(database).run(sql`
    INSERT INTO ${profiles}
      (user_id, login, name, avatar_url, location, website, bio, has_sponsors, synced_at)
    SELECT ${userId}, ${profile.login}, ${profile.name}, ${profile.avatarUrl},
      ${profile.location}, ${profile.website}, ${profile.bio}, ${hasSponsors ? 1 : 0}, ${now}
    WHERE EXISTS (
      SELECT 1 FROM ${authAccount}
      WHERE ${authAccount.providerId} = 'github'
        AND ${authAccount.accountId} = ${userId}
    )
    ON CONFLICT (user_id) DO UPDATE SET
      login = excluded.login,
      name = excluded.name,
      avatar_url = excluded.avatar_url,
      location = excluded.location,
      website = excluded.website,
      bio = excluded.bio,
      has_sponsors = ${hasSponsors === null ? sql`profiles.has_sponsors` : sql`excluded.has_sponsors`},
      synced_at = excluded.synced_at`)
}

/** The author's synced profile, or null before their first sync. */
export async function readProfile(
  database: D1Database,
  userId: string,
): Promise<SyncedProfile | null> {
  const row = await drizzle(database)
    .select()
    .from(profiles)
    .where(eq(profiles.user_id, userId))
    .get()
  if (!row) return null
  return {
    login: row.login,
    name: row.name,
    // Stored values become links and image sources: check them again.
    avatarUrl: avatarUrlOf(row.avatar_url),
    location: row.location,
    website: websiteOf(row.website),
    // Stored text is shown as it is, but never longer than a bio may be.
    bio: bioOf(row.bio),
    hasSponsors: row.has_sponsors,
    syncedAt: row.synced_at,
  }
}
