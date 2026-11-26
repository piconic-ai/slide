import type { DBAdapter, DBAdapterInstance, Where } from 'better-auth'
import {
  addressOf,
  columnsFor,
  EmailCryptoError,
  normalizeForLookup,
  storedForms,
  type EmailCrypto,
} from './email-cipher'
import { assertKeysFitData, freshIv, sealInviteFor } from './email-store'

/**
 * The boundary of D-82. Better Auth is given an adapter that opens and seals
 * the address of a user on its way through: what Better Auth writes and
 * reads is the address, lowercase as it always was, and what reaches D1 is
 * the two columns of `email-cipher.ts`. Nothing outside `src/db/` and the
 * one line in `src/auth/auth-store.ts` that installs it knows.
 *
 * The user's address is reached in four ways, and each is covered here:
 * a `where` on `email` (found by its stored forms), a row read back (opened,
 * also where it is joined under a session), a row written (sealed), and an
 * update of `email` (sealed). Anything else that would touch the address,
 * such as sorting or matching a part of it, is refused rather than done
 * wrongly.
 */
const USER = 'user'

type Row = Record<string, unknown>

/** Where a clause names the address, its forms stand in for the value. */
async function rewriteWhere(
  config: EmailCrypto,
  where: Where[] | undefined,
): Promise<Where[] | undefined> {
  if (!where) return where
  return Promise.all(
    where.map(async (clause) => {
      if (clause.field !== 'email') return clause
      const operator = clause.operator ?? 'eq'
      const values =
        typeof clause.value === 'string'
          ? [clause.value]
          : Array.isArray(clause.value) &&
              clause.value.every((value) => typeof value === 'string')
            ? (clause.value as string[])
            : null
      const supported = ['eq', 'ne', 'in', 'not_in']
      if (values === null || !supported.includes(operator))
        throw new EmailCryptoError('unsupported_query')
      if (config.kind === 'invalid') throw new EmailCryptoError('not_usable')
      const forms = (
        await Promise.all(values.map((value) => storedForms(config, value)))
      ).flat()
      const negative = operator === 'ne' || operator === 'not_in'
      const { mode: _mode, ...rest } = clause
      return {
        ...rest,
        operator: negative ? 'not_in' : 'in',
        value: forms,
      } as Where
    }),
  )
}

/** A row of the user model as Better Auth sees it: the address opened. */
async function openRow<T>(config: EmailCrypto, row: T): Promise<T> {
  if (!row || typeof row !== 'object') return row
  const { emailCiphertext, ...rest } = row as Row
  if (typeof rest.email !== 'string') return rest as T
  const email = await addressOf(config, {
    email: rest.email,
    emailCiphertext:
      typeof emailCiphertext === 'string' ? emailCiphertext : null,
  })
  return { ...rest, email } as T
}

/** A row of any model, with its joined user (if any) opened. */
async function openJoined<T>(
  config: EmailCrypto,
  model: string,
  row: T,
): Promise<T> {
  if (!row || typeof row !== 'object') return row
  if (model === USER) return openRow(config, row)
  const joined = (row as Row)[USER]
  if (!joined || typeof joined !== 'object') return row
  return { ...(row as Row), [USER]: await openRow(config, joined) } as T
}

/** The columns an address becomes, in the names of the user model's fields. */
async function sealedFields(config: EmailCrypto, email: string): Promise<Row> {
  const columns = await columnsFor(config, normalizeForLookup(email), freshIv())
  return { email: columns.email, emailCiphertext: columns.emailCiphertext }
}

/** Asks for the ciphertext too, when a read names the address's field. */
const withCiphertext = (select: string[] | undefined) =>
  select && select.includes('email') && !select.includes('emailCiphertext')
    ? [...select, 'emailCiphertext']
    : select

export type EmailBoundary = Readonly<{
  config: EmailCrypto
  database: D1Database
}>

/** Wraps an adapter of Better Auth in the boundary. */
export function withEmailBoundary(
  inner: DBAdapter,
  boundary: EmailBoundary,
): DBAdapter {
  const { config } = boundary
  const guard = (model: string, fields: Row | undefined) => {
    if (
      model === USER &&
      fields &&
      'email' in fields &&
      config.kind === 'invalid'
    )
      throw new EmailCryptoError('not_usable')
  }
  const wrapped = {
    ...inner,
    create: async (input: Parameters<DBAdapter['create']>[0]) => {
      if (input.model !== USER) return inner.create(input)
      const data = input.data as Row
      guard(USER, data)
      if (typeof data.email !== 'string') return inner.create(input)
      await assertKeysFitData(boundary.database, config)
      await sealInviteFor(boundary.database, config, data.email)
      const created = await inner.create({
        ...input,
        data: { ...data, ...(await sealedFields(config, data.email)) },
      } as typeof input)
      return openRow(config, created)
    },
    findOne: async (input: Parameters<DBAdapter['findOne']>[0]) =>
      openJoined(
        config,
        input.model,
        await inner.findOne({
          ...input,
          where: (await rewriteWhere(config, input.where)) as Where[],
          select:
            input.model === USER ? withCiphertext(input.select) : input.select,
        }),
      ),
    findMany: async (input: Parameters<DBAdapter['findMany']>[0]) => {
      if (input.model === USER && input.sortBy?.field === 'email')
        throw new EmailCryptoError('unsupported_query')
      const rows = await inner.findMany({
        ...input,
        where: await rewriteWhere(config, input.where),
        select:
          input.model === USER ? withCiphertext(input.select) : input.select,
      })
      return Promise.all(
        rows.map((row) => openJoined(config, input.model, row)),
      )
    },
    count: async (input: Parameters<DBAdapter['count']>[0]) =>
      inner.count({ ...input, where: await rewriteWhere(config, input.where) }),
    update: async (input: Parameters<DBAdapter['update']>[0]) => {
      const sealed = await sealedUpdate(config, input.model, input.update)
      return openJoined(
        config,
        input.model,
        await inner.update({
          ...input,
          where: (await rewriteWhere(config, input.where)) as Where[],
          update: sealed,
        }),
      )
    },
    updateMany: async (input: Parameters<DBAdapter['updateMany']>[0]) =>
      inner.updateMany({
        ...input,
        where: (await rewriteWhere(config, input.where)) as Where[],
        update: await sealedUpdate(config, input.model, input.update),
      }),
    delete: async (input: Parameters<DBAdapter['delete']>[0]) =>
      inner.delete({
        ...input,
        where: (await rewriteWhere(config, input.where)) as Where[],
      }),
    deleteMany: async (input: Parameters<DBAdapter['deleteMany']>[0]) =>
      inner.deleteMany({
        ...input,
        where: (await rewriteWhere(config, input.where)) as Where[],
      }),
    consumeOne: async (input: Parameters<DBAdapter['consumeOne']>[0]) =>
      openJoined(
        config,
        input.model,
        await inner.consumeOne({
          ...input,
          where: (await rewriteWhere(config, input.where)) as Where[],
        }),
      ),
    incrementOne: async (input: Parameters<DBAdapter['incrementOne']>[0]) =>
      openJoined(
        config,
        input.model,
        await inner.incrementOne({
          ...input,
          where: (await rewriteWhere(config, input.where)) as Where[],
        }),
      ),
    transaction: <R>(run: (adapter: never) => Promise<R>) =>
      inner.transaction((trx) =>
        run(withEmailBoundary(trx as unknown as DBAdapter, boundary) as never),
      ),
  } as DBAdapter
  return wrapped
}

async function sealedUpdate(
  config: EmailCrypto,
  model: string,
  update: Row,
): Promise<Row> {
  if (model !== USER || !('email' in update)) return update
  if (typeof update.email !== 'string')
    throw new EmailCryptoError('unsupported_query')
  return { ...update, ...(await sealedFields(config, update.email)) }
}

/** The adapter of Better Auth with the boundary around it. */
export const emailBoundary =
  (adapter: DBAdapterInstance, boundary: EmailBoundary): DBAdapterInstance =>
  (options) =>
    withEmailBoundary(adapter(options), boundary)
