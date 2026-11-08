import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decks, deployments } from '../db/schema'
import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from '../db/test-migrations'
import { parseDeckPublication } from './state'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
afterAll(() => platform.dispose())

test('Given rows from before F02, When 0006 is applied, Then decks are manual drafts and old uploads have no start revision', async () => {
  await applyMigrations(db, { until: '0005_decks.sql' })
  await orm.batch([
    orm.run(sql`INSERT INTO decks VALUES ('talk', '722500', 1)`),
    orm.run(
      sql`INSERT INTO deployments (id, idempotency_key, inventory_digest, source_sha, run_id, run_attempt, actor_id, repository_id, owner_id, source_ref, state, total_bytes, token_hash, created_at, expires_at, credential_expires_at, ready_at, deck_id)
       VALUES ('d', 'k', 'g', 's', '1', '1', '722500', '1', '2', 'refs/heads/main', 'ready', 1, 'h', 1, 2, 2, 1, 'talk')`,
    ),
  ])
  await applyMigrations(db, { after: '0005_decks.sql' })
  const deck = await orm.select().from(decks).get()
  expect(parseDeckPublication(deck)).toEqual({
    mode: 'manual',
    publication: { kind: 'draft' },
    revision: 0,
    authorRevision: 0,
    lastCiRun: null,
  })
  expect(
    await orm
      .select({
        start_revision: deployments.start_revision,
        publish_intent: deployments.publish_intent,
      })
      .from(deployments)
      .get(),
  ).toEqual({ start_revision: null, publish_intent: null })
})
