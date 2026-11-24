import { drizzle } from 'drizzle-orm/d1'
import { sql } from 'drizzle-orm'
import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { seedDeck, seedDeployment } from '../publication/test-support'
import { deployments } from './schema'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const orm = drizzle(platform.env.DB)
afterAll(() => platform.dispose())

const tableExists = async () =>
  (await orm.get(
    sql`SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'page_script_deployments'`,
  )) !== undefined

test('F05-AC23: Given versions noted as loading the page script, When every migration is applied, Then the note is gone and the versions remain', async () => {
  const database = platform.env.DB
  await applyMigrations(database, { until: '0046_article_draft.sql' })
  await seedDeck(database, 'talk')
  const id = await seedDeployment(database, 'talk')
  await orm.run(
    sql`INSERT INTO page_script_deployments (deployment_id) VALUES (${id})`,
  )
  expect(await tableExists()).toBe(true)

  await applyMigrations(database, { after: '0046_article_draft.sql' })

  expect(await tableExists()).toBe(false)
  expect(
    (await orm.select({ id: deployments.id }).from(deployments)).map(
      (row) => row.id,
    ),
  ).toEqual([id])
})
