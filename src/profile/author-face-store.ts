import { sql } from 'drizzle-orm'
import { accounts, profilePictures, profiles } from '../db/schema'

/**
 * The columns that decide an author's face, for a list's query to read
 * beside each slide, so a card's picture costs no query of its own. They
 * need `authorFaceJoins` on `accounts`. Their names are those of
 * `authorFaceColumns`.
 */
export const authorFaceFields = {
  authorUserId: accounts.user_id,
  uploadedAt: profilePictures.uploaded_at,
  useGravatar: profiles.use_gravatar,
  gravatarAt: profiles.gravatar_at,
}

/** The same columns, for a query written as SQL. */
export const authorFaceSelect = sql`${accounts.user_id} AS authorUserId,
  ${profilePictures.uploaded_at} AS uploadedAt,
  ${profiles.use_gravatar} AS useGravatar,
  ${profiles.gravatar_at} AS gravatarAt`

/** The authors may have no profile and no picture: left joins, on the key. */
export const authorFaceJoins = sql`
  LEFT JOIN ${profiles} ON ${profiles.user_id} = ${accounts.user_id}
  LEFT JOIN ${profilePictures}
    ON ${profilePictures.user_id} = ${accounts.user_id}`
