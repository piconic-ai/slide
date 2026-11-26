import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  addressOf,
  columnsFor,
  EmailCryptoError,
  keyVersions,
  normalizeForLookup,
  type EmailCrypto,
} from './email-cipher'

/** A fresh IV for sealing: 12 random bytes, drawn for each sealed text. */
export const freshIv = (): Uint8Array =>
  crypto.getRandomValues(new Uint8Array(12))

type SealedRow = { email: string; email_ciphertext: string }

/**
 * Refuses to go on when the keys do not fit the data. A person who is not
 * found because the lookup key is wrong would be made a second user, and so
 * a second account; this reads one sealed row, opens it and checks that its
 * lookup value is the one the keys give, before any user is made. With no
 * sealed row there is nothing the keys could contradict. A key that is off,
 * or has no version of any sealed row, is refused too: an environment that
 * lost its keys must not start writing plain rows beside sealed ones.
 *
 * The errors carry a code only (F41-AC14, F41-AC15).
 */
export async function assertKeysFitData(
  database: D1Database,
  config: EmailCrypto,
): Promise<void> {
  if (config.kind === 'invalid') throw new EmailCryptoError('not_usable')
  const db = drizzle(database)
  const versions = keyVersions(config)
  const held = versions.length
    ? sql.join(
        versions.map(
          (version) => sql`email_ciphertext LIKE ${`ec1.${version}.%`}`,
        ),
        sql` OR `,
      )
    : sql`0`
  const sample = (table: 'auth_user' | 'invited_emails') =>
    db.all<SealedRow>(
      sql`SELECT email, email_ciphertext FROM ${sql.raw(table)}
        WHERE email_ciphertext IS NOT NULL AND (${held}) LIMIT 1`,
    )
  const [row] = [
    ...(await sample('auth_user')),
    ...(await sample('invited_emails')),
  ]
  if (row) {
    await addressOf(config, {
      email: row.email,
      emailCiphertext: row.email_ciphertext,
    })
    return
  }
  const any = await db.all<{ n: number }>(
    sql`SELECT (SELECT count(*) FROM auth_user WHERE email_ciphertext IS NOT NULL)
      + (SELECT count(*) FROM invited_emails WHERE email_ciphertext IS NOT NULL) AS n`,
  )
  if ((any[0]?.n ?? 0) > 0)
    throw new EmailCryptoError(
      config.kind === 'off' ? 'not_usable' : 'unknown_version',
    )
}

/**
 * Before a first sign-in makes the person's user row, a plain invitation for
 * their address is sealed. A sealed user beside a plain invitation would
 * read as someone no longer invited, since the two rows are matched by the
 * `email` column (docs/dev/f41-email-encryption.md, "A pair stays in one
 * state"). With the keys off, nothing changes.
 */
export async function sealInviteFor(
  database: D1Database,
  config: EmailCrypto,
  email: string,
): Promise<void> {
  if (config.kind !== 'on') return
  const plain = normalizeForLookup(email)
  const columns = await columnsFor(config, plain, freshIv())
  await database
    .prepare(
      `UPDATE invited_emails SET email = ?1, email_ciphertext = ?2
        WHERE email = ?3 AND email_ciphertext IS NULL`,
    )
    .bind(columns.email, columns.emailCiphertext, plain)
    .run()
}
