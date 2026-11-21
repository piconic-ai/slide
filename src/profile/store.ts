import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { profiles } from '../db/schema'
import { bioOf, websiteOf } from './profile-lines'

/** What an author wrote about themselves. */
export type StoredProfile = Readonly<{
  name: string
  /** The picture's address; none until the profile's pictures (F28-AC41). */
  avatarUrl: string | null
  location: string | null
  website: string | null
  bio: string | null
}>

/** The author's profile, or null before they chose a display name. */
export async function readProfile(
  database: D1Database,
  userId: string,
): Promise<StoredProfile | null> {
  const row = await drizzle(database)
    .select()
    .from(profiles)
    .where(eq(profiles.user_id, userId))
    .get()
  if (!row) return null
  return {
    name: row.name,
    avatarUrl: null,
    location: row.location,
    // Stored values become links: check them again.
    website: websiteOf(row.website),
    // Stored text is shown as it is, but never longer than a bio may be.
    bio: bioOf(row.bio),
  }
}
