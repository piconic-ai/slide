import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { seedDeck, seedDeployment } from '../publication/test-support'
import { decks, deployments } from './schema'
import { applyMigrations } from './test-migrations'

const BEFORE = '0029_deployment_source.sql'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
let kept = ''

beforeAll(async () => {
  await applyMigrations(database, { until: BEFORE })
  await seedDeck(database, 'talk')
  kept = await seedDeployment(database, 'talk')
  await db.run(sql`INSERT INTO repository_bindings
    (deck_id, repository_id, repository_owner_id, repository_full_name,
     allowed_refs, verified_by, verified_at)
    VALUES ('talk', '1', '2', 'owner/slides', '["refs/heads/main"]', '722500', 1)`)
  await db.run(
    sql`UPDATE decks SET public_deployment_id = ${kept}, revision = 1,
      author_revision = 1 WHERE id = 'talk'`,
  )
  await applyMigrations(database, { after: BEFORE })
})
afterAll(() => platform.dispose())

const tablesOf = async (target: D1Database) =>
  (
    await drizzle(target).all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table'`,
    )
  ).map(({ name }) => name)

test('F22-AC31: Given an empty D1, When every migration is applied from the first to the last, Then the schema has no repository_bindings table', async () => {
  const empty = await getPlatformProxy<Env>({ persist: false })
  try {
    await applyMigrations(empty.env.DB)

    const tables = await tablesOf(empty.env.DB)
    expect(tables).not.toContain('repository_bindings')
    expect(tables).toEqual(expect.arrayContaining(['decks', 'deployments']))
  } finally {
    await empty.dispose()
  }
})

test('F22-AC31: Given a slide connected to a repository before the removal, When the migrations are applied, Then the connection is gone and the slide, its version and its publication are kept', async () => {
  expect(await tablesOf(database)).not.toContain('repository_bindings')
  expect(
    await db
      .select({
        id: decks.id,
        public: decks.public_deployment_id,
        revision: decks.revision,
      })
      .from(decks),
  ).toEqual([{ id: 'talk', public: kept, revision: 1 }])
  expect(
    await db
      .select({ id: deployments.id, state: deployments.state })
      .from(deployments),
  ).toEqual([{ id: kept, state: 'ready' }])
})
