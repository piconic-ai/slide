import { eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { accounts, profilePictures, profiles } from '../db/schema'
import { facePath, faceSourceOf } from './face'

/** How many handles one query names; D1 binds at most 100 values. */
const HANDLES_PER_QUERY = 50

/**
 * The picture address of each author, by handle, for the cards of a list.
 * An author with no account has no entry. Like the people lists, a person
 * with no profile row yet has Gravatar on, as everyone starts.
 */
export async function readAuthorFaces(
  database: D1Database,
  handles: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(handles)]
  const db = drizzle(database)
  const found = await Promise.all(
    Array.from(
      { length: Math.ceil(unique.length / HANDLES_PER_QUERY) },
      (_, i) =>
        db
          .select({
            userId: accounts.user_id,
            handle: accounts.handle,
            uploadedAt: profilePictures.uploaded_at,
            useGravatar: profiles.use_gravatar,
            gravatarAt: profiles.gravatar_at,
          })
          .from(accounts)
          .leftJoin(profiles, eq(profiles.user_id, accounts.user_id))
          .leftJoin(
            profilePictures,
            eq(profilePictures.user_id, accounts.user_id),
          )
          .where(
            inArray(
              accounts.handle,
              unique.slice(i * HANDLES_PER_QUERY, (i + 1) * HANDLES_PER_QUERY),
            ),
          ),
    ),
  )
  return new Map(
    found.flat().flatMap((row) =>
      row.handle === null
        ? []
        : [
            [
              row.handle,
              facePath(
                row.userId,
                faceSourceOf({
                  uploadedAt: row.uploadedAt,
                  useGravatar: row.useGravatar !== 0,
                  gravatarAt: row.gravatarAt,
                }),
              ),
            ] as const,
          ],
    ),
  )
}
