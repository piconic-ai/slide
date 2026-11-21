import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from '../db/test-migrations'
import { readLatestReady, readPointedVersion } from './store'
import { resetTables, seedDeck, seedDeployment } from './test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await seedDeck(db, 'talk')
})
afterAll(() => platform.dispose())

test('F02-AC49: Given versions received in the same second, When the newest is read, Then it is the one put in last, whatever their random IDs', async () => {
  // seedDeployment gives every version ready_at 1 and a random ID, so an
  // order decided by ID would pick the last one only once in a while.
  const ids: string[] = []
  for (let index = 0; index < 24; index++)
    ids.push(await seedDeployment(db, 'talk'))

  const latest = await readLatestReady(db, 'talk')

  expect(latest?.deploymentId).toBe(ids.at(-1))
})

test('F02-AC49: Given two versions of the same second, When each is read as the one the publication points at, Then the later one carries a greater order than the earlier', async () => {
  const first = await seedDeployment(db, 'talk')
  const second = await seedDeployment(db, 'talk')

  const a = await readPointedVersion(db, 'talk', first)
  const b = await readPointedVersion(db, 'talk', second)

  expect(a?.readyAt).toBe(b?.readyAt)
  expect(b!.order).toBeGreaterThan(a!.order)
})
