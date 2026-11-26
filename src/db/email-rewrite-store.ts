import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  addressOf,
  columnsFor,
  EmailCryptoError,
  type EmailCrypto,
} from './email-cipher'
import { assertKeysFitData, freshIv } from './email-store'
import {
  REWRITE_LIMIT,
  type EmailCounts,
  type RewriteResult,
} from './email-rewrite'

type On = Extract<EmailCrypto, { kind: 'on' }>

const usable = (config: EmailCrypto): On => {
  if (config.kind !== 'on') throw new EmailCryptoError('not_usable')
  return config
}

/** How many rows of both tables are plain, older, or current. */
export async function countEmailRows(
  database: D1Database,
  config: On,
): Promise<EmailCounts> {
  const current = `ec1.${config.current}.%`
  const [row] = await drizzle(database).all<{
    plain: number
    older: number
    current: number
  }>(sql`SELECT
      (SELECT count(*) FROM auth_user WHERE email_ciphertext IS NULL)
        + (SELECT count(*) FROM invited_emails WHERE email_ciphertext IS NULL) AS plain,
      (SELECT count(*) FROM auth_user
          WHERE email_ciphertext IS NOT NULL AND email_ciphertext NOT LIKE ${current})
        + (SELECT count(*) FROM invited_emails
          WHERE email_ciphertext IS NOT NULL AND email_ciphertext NOT LIKE ${current}) AS older,
      (SELECT count(*) FROM auth_user WHERE email_ciphertext LIKE ${current})
        + (SELECT count(*) FROM invited_emails WHERE email_ciphertext LIKE ${current}) AS current`)
  return {
    plain: row?.plain ?? 0,
    olderVersion: row?.older ?? 0,
    current: row?.current ?? 0,
  }
}

/** The addresses of plain rows, users first, each address once. */
async function plainAddresses(
  database: D1Database,
  limit: number,
): Promise<string[]> {
  const db = drizzle(database)
  const users = await db.all<{ email: string }>(
    sql`SELECT email FROM auth_user WHERE email_ciphertext IS NULL
      ORDER BY id LIMIT ${limit}`,
  )
  const invites = await db.all<{ email: string }>(
    sql`SELECT email FROM invited_emails WHERE email_ciphertext IS NULL
      ORDER BY email LIMIT ${limit}`,
  )
  return [...new Set([...users, ...invites].map((row) => row.email))].slice(
    0,
    limit,
  )
}

/**
 * Seals one plain address in both tables in one batch, which D1 runs as one
 * transaction: a user and the invitation of the same address change state
 * together, so they stay matched (docs/dev/f41-email-encryption.md). The
 * `email_ciphertext IS NULL` conditions make a second run, or a run beside
 * this one, change nothing.
 */
async function sealAddress(
  database: D1Database,
  config: On,
  plain: string,
): Promise<void> {
  const user = await columnsFor(config, plain, freshIv())
  const invite = await columnsFor(config, plain, freshIv())
  const update = (table: string, columns: typeof user) =>
    database
      .prepare(
        `UPDATE ${table} SET email = ?1, email_ciphertext = ?2
          WHERE email = ?3 AND email_ciphertext IS NULL`,
      )
      .bind(columns.email, columns.emailCiphertext, plain)
  await database.batch([
    update('auth_user', user),
    update('invited_emails', invite),
  ])
}

type SealedRow = { email: string; email_ciphertext: string }

/** Rows sealed under a version other than the current one. */
async function olderRows(
  database: D1Database,
  config: On,
  table: 'auth_user' | 'invited_emails',
  limit: number,
): Promise<SealedRow[]> {
  return drizzle(database).all<SealedRow>(
    sql`SELECT email, email_ciphertext FROM ${sql.raw(table)}
      WHERE email_ciphertext IS NOT NULL
        AND email_ciphertext NOT LIKE ${`ec1.${config.current}.%`}
      LIMIT ${limit}`,
  )
}

/**
 * Seals one row again under the current key version. The update names the
 * sealed text it read, so a row changed in the meantime is left alone.
 */
async function resealRow(
  database: D1Database,
  config: On,
  table: 'auth_user' | 'invited_emails',
  row: SealedRow,
): Promise<void> {
  const address = await addressOf(config, {
    email: row.email,
    emailCiphertext: row.email_ciphertext,
  })
  const columns = await columnsFor(config, address, freshIv())
  await database
    .prepare(
      `UPDATE ${table} SET email_ciphertext = ?1
        WHERE email = ?2 AND email_ciphertext = ?3`,
    )
    .bind(columns.emailCiphertext, row.email, row.email_ciphertext)
    .run()
}

/**
 * One press of "書き換える" (D-84): seals plain addresses, then seals older
 * versions again with what room is left, at most `limit` in all. A row that
 * fails stays as it was and the next press handles it. Refuses to start when
 * the keys do not fit the data, so a wrong key cannot touch a row.
 */
export async function rewriteEmails(
  database: D1Database,
  config: EmailCrypto,
  limit: number = REWRITE_LIMIT,
): Promise<RewriteResult> {
  const on = usable(config)
  await assertKeysFitData(database, on)
  let sealed = 0
  let resealed = 0
  let failed = 0
  const addresses = await plainAddresses(database, limit)
  for (const address of addresses) {
    try {
      await sealAddress(database, on, address)
      sealed += 1
    } catch {
      failed += 1
    }
  }
  let room = limit - addresses.length
  for (const table of ['auth_user', 'invited_emails'] as const) {
    if (room <= 0) break
    const rows = await olderRows(database, on, table, room)
    room -= rows.length
    for (const row of rows) {
      try {
        await resealRow(database, on, table, row)
        resealed += 1
      } catch {
        failed += 1
      }
    }
  }
  return {
    sealed,
    resealed,
    failed,
    remaining: await countEmailRows(database, on),
  }
}
