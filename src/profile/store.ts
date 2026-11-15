import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { profiles } from '../db/schema'
import { avatarUrlOf, websiteOf, type Profile } from './github-profile'

export type SyncedProfile = Profile &
  Readonly<{ hasSponsors: boolean; syncedAt: number }>

/**
 * Replaces the author's profile with what GitHub answered at this sign-in.
 * `hasSponsors` is null when GitHub did not say; the last known answer then
 * stays, and a first sync starts without the link.
 */
export async function saveProfile(
  database: D1Database,
  userId: string,
  profile: Profile,
  hasSponsors: boolean | null,
  now: number,
): Promise<void> {
  const row = {
    login: profile.login,
    name: profile.name,
    avatar_url: profile.avatarUrl,
    location: profile.location,
    website: profile.website,
    synced_at: now,
  }
  await drizzle(database)
    .insert(profiles)
    .values({ user_id: userId, ...row, has_sponsors: hasSponsors ?? false })
    .onConflictDoUpdate({
      target: profiles.user_id,
      set: {
        ...row,
        has_sponsors:
          hasSponsors === null ? sql`${profiles.has_sponsors}` : hasSponsors,
      },
    })
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
    hasSponsors: row.has_sponsors,
    syncedAt: row.synced_at,
  }
}
