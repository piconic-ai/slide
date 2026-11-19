import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { seedDeck, seedDeployment } from '../publication/test-support'
import { decks, deployments, uploadFiles } from './schema'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
let kept = ''

beforeAll(async () => {
  await applyMigrations(database, { until: '0028_follows.sql' })
  await seedDeck(database, 'talk')
  kept = await seedDeployment(database, 'talk')
  await db.run(sql`INSERT INTO upload_files
    (deployment_id, id, path, size, sha256, media_type, object_key)
    VALUES (${kept}, '0', 'index.html', 1, ${'a'.repeat(64)}, 'text/html', 'k')`)
  await db.run(
    sql`UPDATE decks SET public_deployment_id = ${kept} WHERE id = 'talk'`,
  )
  await applyMigrations(database, {
    after: '0028_follows.sql',
    until: '0029_deployment_source.sql',
  })
})
afterAll(() => platform.dispose())

const columns = async () =>
  (
    await db.all<{ name: string }>(
      sql`SELECT name FROM pragma_table_info('deployments')`,
    )
  ).map(({ name }) => name)

test('Given migration 0029, When the deployments table is read, Then no column names a GitHub workflow and source says where a version was sent from', async () => {
  const names = await columns()

  for (const gone of [
    'source_sha',
    'run_id',
    'run_attempt',
    'actor_id',
    'repository_id',
    'owner_id',
    'source_ref',
  ])
    expect(names).not.toContain(gone)
  expect(names).toContain('source')
  // What the upload itself needs stays.
  expect(names).toEqual(
    expect.arrayContaining(['idempotency_key', 'inventory_digest', 'deck_id']),
  )
})

test('Given a deployment a deck points at before 0029, When it is migrated, Then the row, its files and the pointer are kept', async () => {
  expect(
    await db
      .select({ id: deployments.id, state: deployments.state })
      .from(deployments),
  ).toEqual([{ id: kept, state: 'ready' }])
  expect(await db.$count(uploadFiles)).toBe(1)
  expect(
    await db.select({ public: decks.public_deployment_id }).from(decks),
  ).toEqual([{ public: kept }])
})

test.each(['github', '', 'Browser'])(
  'Given migration 0029, When a deployment names %j as its source, Then the insert is refused',
  async (source) => {
    await expect(
      db.run(sql`INSERT INTO deployments
        (id, idempotency_key, inventory_digest, state, total_bytes, token_hash,
         created_at, expires_at, credential_expires_at, deck_id, source)
        VALUES (${`bad-${source}`}, ${`bad-${source}`}, 'g', 'uploading', 1,
          'h', 1, 2, 2, 'talk', ${source})`),
    ).rejects.toThrow()
  },
)

test.each(['browser', 'mcp'] as const)(
  'Given migration 0029, When a deployment sent from %s is stored, Then it is read back with that source',
  async (source) => {
    await db.insert(deployments).values({
      id: `from-${source}`,
      idempotency_key: `from-${source}`,
      inventory_digest: 'g',
      source,
      state: 'uploading',
      total_bytes: 1,
      token_hash: 'h',
      created_at: 1,
      expires_at: 2,
      credential_expires_at: 2,
      deck_id: 'talk',
    })

    expect(
      await db
        .select({ source: deployments.source })
        .from(deployments)
        .where(sql`${deployments.id} = ${`from-${source}`}`),
    ).toEqual([{ source }])
  },
)

test('F22-AC19: Given an empty D1, When every migration is applied from the first to the last, Then all of them apply and the schema has the tables an upload needs', async () => {
  const empty = await getPlatformProxy<Env>({ persist: false })
  try {
    await applyMigrations(empty.env.DB)

    const tables = (
      await drizzle(empty.env.DB).all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type = 'table'`,
      )
    ).map(({ name }) => name)
    expect(tables).toEqual(
      expect.arrayContaining(['decks', 'deployments', 'upload_files']),
    )
    expect(
      await drizzle(empty.env.DB).all(
        sql`SELECT name FROM pragma_table_info('deployments') WHERE name = 'source'`,
      ),
    ).toEqual([{ name: 'source' }])
  } finally {
    await empty.dispose()
  }
})
