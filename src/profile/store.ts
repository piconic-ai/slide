import { asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { authUser } from '../db/auth-schema'
import { accounts, profileLinks, profilePictures, profiles } from '../db/schema'
import { facePath, faceSourceOf, type FaceFacts } from './face'
import type { ProfileInput } from './profile-input'
import { bioOf, linkOf } from './profile-lines'

/** What an author wrote about themselves. */
export type StoredProfile = Readonly<{
  name: string
  /**
   * Where the picture is served from, an address that changes with the
   * picture. It answers 404 for no picture.
   */
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
  const [found, links] = await Promise.all([
    db
      .select({ row: profiles, uploadedAt: profilePictures.uploaded_at })
      .from(profiles)
      .leftJoin(profilePictures, eq(profilePictures.user_id, profiles.user_id))
      .where(eq(profiles.user_id, userId))
      .get(),
    db
      .select({ url: profileLinks.url })
      .from(profileLinks)
      .where(eq(profileLinks.user_id, userId))
      .orderBy(asc(profileLinks.position)),
  ])
  if (!found) return null
  const { row, uploadedAt } = found
  return {
    name: row.name,
    avatarUrl: facePath(
      userId,
      faceSourceOf({
        uploadedAt,
        useGravatar: row.use_gravatar === 1,
        gravatarAt: row.gravatar_at,
      }),
    ),
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
 * Turning Gravatar off forgets when it was asked, as the picture kept from
 * it goes too.
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
    ...(profile.useGravatar ? {} : { gravatar_at: null }),
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
 * What decides the person's face, or null when they have no account. A
 * person who wrote no profile yet has Gravatar on, as everyone starts.
 */
export async function readFaceFacts(
  database: D1Database,
  userId: string,
): Promise<FaceFacts | null> {
  const row = await drizzle(database)
    .select({
      uploadedAt: profilePictures.uploaded_at,
      useGravatar: profiles.use_gravatar,
      gravatarAt: profiles.gravatar_at,
    })
    .from(accounts)
    .leftJoin(profiles, eq(profiles.user_id, accounts.user_id))
    .leftJoin(profilePictures, eq(profilePictures.user_id, accounts.user_id))
    .where(eq(accounts.user_id, userId))
    .get()
  if (!row) return null
  return {
    uploadedAt: row.uploadedAt,
    useGravatar: row.useGravatar !== 0,
    gravatarAt: row.gravatarAt,
  }
}

/** Notes when Gravatar was asked for the person's picture, in seconds. */
export async function markGravatarAsked(
  database: D1Database,
  userId: string,
  at: number,
): Promise<void> {
  await drizzle(database)
    .update(profiles)
    .set({ gravatar_at: at })
    .where(eq(profiles.user_id, userId))
}
