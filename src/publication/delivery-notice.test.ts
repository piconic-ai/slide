import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedDeck,
  seedDeployment,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from './test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const base = testEnv(platform.env)

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await seedDeck(db, 'talk')
})
afterAll(() => platform.dispose())

const page = async (env: Env) => {
  const cookie = await signIn(env)
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/decks/talk`, { headers: { Cookie: cookie } }),
    env,
  )
  expect(response.status).toBe(200)
  return (await response.text()).replace(/\s+/g, ' ')
}

test.each([
  ['no content origin', undefined],
  ['an invalid content origin', 'http://content.example'],
])(
  'Given %s, When the deck page renders, Then it says versions cannot be opened yet and offers no owner-only view',
  async (_, value) => {
    const id = await seedDeployment(db, 'talk')
    const body = await page({ ...base, CONTENT_ORIGIN: value } as Env)
    expect(body).toContain('配信ドメインが未設定のため')
    expect(body).not.toContain(`/deployments/${id}/preview`)
    expect(body).toContain(`name="deploymentId" value="${id}"`)
  },
)

test('Given a content origin, When the deck page renders, Then owner-only viewing is offered without the notice', async () => {
  const id = await seedDeployment(db, 'talk')
  const body = await page({
    ...base,
    CONTENT_ORIGIN: 'https://content.example',
  } as Env)
  expect(body).not.toContain('配信ドメインが未設定のため')
  expect(body).toContain(`/deployments/${id}/preview`)
})
