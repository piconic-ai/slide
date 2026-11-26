import {
  integer,
  sqliteTable,
  text,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

export const authUser = sqliteTable('auth_user', {
  id: text().primaryKey(),
  name: text().notNull(),
  /**
   * The address while the row is plain; `enc1:` and the lookup value once it
   * is sealed (see email-cipher.ts and migrations/0059).
   */
  email: text().notNull().unique(),
  /** The sealed address, or null while the row is plain. */
  emailCiphertext: text('email_ciphertext'),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull(),
  image: text(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})
export const authSession = sqliteTable(
  'auth_session',
  {
    id: text().primaryKey(),
    token: text().notNull().unique(),
    // One row per signed-in device: a person may have several (F28-AC102).
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    /** The rough name of the device, from its user agent (F28-AC111). */
    device: text(),
  },
  (table) => [index('auth_session_user').on(table.userId)],
)
export const authAccount = sqliteTable(
  'auth_account',
  {
    id: text().primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    scope: text(),
    password: text(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('auth_account_provider_identity').on(t.providerId, t.accountId),
    index('auth_account_user').on(t.userId),
  ],
)
export const authVerification = sqliteTable(
  'auth_verification',
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('auth_verification_identifier').on(t.identifier)],
)
