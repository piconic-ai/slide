import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
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
  ['an empty content origin', ''],
  ['an invalid content origin', 'http://content.example'],
])(
  'Given %s, When the deck page renders, Then it says versions cannot be opened yet and offers no owner-only view',
  async (_, value) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const id = await seedDeployment(db, 'talk')
    const body = await page({
      ...base,
      CONTENT_ORIGIN: value,
    } as unknown as Env)
    // Only an invalid setting is reported; an absent one is the default.
    expect(logged.mock.calls.length > 0).toBe(
      value === 'http://content.example',
    )
    logged.mockRestore()
    expect(body).toContain('配信ドメインが未設定のため')
    expect(body).not.toContain('作者限定で開くと別の tab')
    expect(body).not.toContain(`/deployments/${id}/preview`)
    expect(body).toContain(`name="deploymentId" value="${id}"`)
  },
)

test('Given a content origin, When the deck page renders, Then owner-only viewing is offered without the notice', async () => {
  const id = await seedDeployment(db, 'talk')
  const body = await page({
    ...base,
    CONTENT_ORIGIN: 'https://content.example',
  } as unknown as Env)
  expect(body).not.toContain('配信ドメインが未設定のため')
  expect(body).toContain(`/deployments/${id}/preview`)
})

test('Given a public version and no content origin, When the deck page renders, Then it is marked public without an owner-only view', async () => {
  const id = await seedDeployment(db, 'talk')
  await db
    .prepare(
      'UPDATE decks SET public_deployment_id = ?, revision = 1, author_revision = 1',
    )
    .bind(id)
    .run()
  const body = await page({
    ...base,
    CONTENT_ORIGIN: undefined,
  } as unknown as Env)
  expect(body).toContain('一般公開中')
  expect(body).not.toContain(`/deployments/${id}/preview`)
})
