import { asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { authUser } from '../db/auth-schema'
import { profileLinks, profiles } from '../db/schema'
import { avatarPath } from './face'
import type { ProfileInput } from './profile-input'
import { bioOf, linkOf } from './profile-lines'

/** What an author wrote about themselves. */
export type StoredProfile = Readonly<{
  name: string
  /** Where the picture is served from. It answers 404 for no picture. */
  avatarUrl: string | null
  location: string | null
  website: string | null
  /** Links to their social accounts, in the order they wrote them. */
  links: readonly string[]
  bio: string | null
  /** Whether their Gravatar picture may show; see the face's order. */
  useGravatar: boolean
}>

/** The author's profile, or null before they chose a display name. */
export async function readProfile(
  database: D1Database,
  userId: string,
): Promise<StoredProfile | null> {
  const db = drizzle(database)
  const [row, links] = await Promise.all([
    db.select().from(profiles).where(eq(profiles.user_id, userId)).get(),
    db
      .select({ url: profileLinks.url })
      .from(profileLinks)
      .where(eq(profileLinks.user_id, userId))
      .orderBy(asc(profileLinks.position)),
  ])
  if (!row) return null
  return {
    name: row.name,
    avatarUrl: avatarPath(userId),
    location: row.location,
    // Stored values become links: check them again.
    website: linkOf(row.website),
    links: links.flatMap(({ url }) => linkOf(url) ?? []),
    // Stored text is shown as it is, but never longer than a bio may be.
    bio: bioOf(row.bio),
    useGravatar: row.use_gravatar === 1,
  }
}

/**
 * Keeps what the author wrote, in one batch: the profile row, then the
 * links, which are replaced as a whole so a removed one does not linger.
 */
export async function saveProfile(
  database: D1Database,
  userId: string,
  profile: ProfileInput,
): Promise<void> {
  const db = drizzle(database)
  const columns = {
    name: profile.name,
    bio: profile.bio,
    location: profile.location,
    website: profile.website,
    use_gravatar: profile.useGravatar ? 1 : 0,
  }
  await db.batch([
    db
      .insert(profiles)
      .values({ user_id: userId, ...columns })
      .onConflictDoUpdate({ target: profiles.user_id, set: columns }),
    db.delete(profileLinks).where(eq(profileLinks.user_id, userId)),
    ...profile.links.map((url, index) =>
      db
        .insert(profileLinks)
        .values({ user_id: userId, position: index + 1, url }),
    ),
  ])
}

/**
 * The address a person signs in with. Only the settings page may show it
 * (F28-AC54); the picture's lookup hashes it and never returns it.
 */
export async function readEmail(
  database: D1Database,
  userId: string,
): Promise<string | null> {
  const row = await drizzle(database)
    .select({ email: authUser.email })
    .from(authUser)
    .where(eq(authUser.id, userId))
    .get()
  return row?.email ?? null
}

/**
 * Whether the person's Gravatar picture may be shown. It is on until they
 * turn it off, which includes a person who wrote no profile yet.
 */
export async function readGravatarChoice(
  database: D1Database,
  userId: string,
): Promise<boolean> {
  const row = await drizzle(database)
    .select({ on: profiles.use_gravatar })
    .from(profiles)
    .where(eq(profiles.user_id, userId))
    .get()
  return row ? row.on === 1 : true
}
