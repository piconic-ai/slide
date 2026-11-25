import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import {
  OWNER_ID,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { resetCommunities, seedCommunity } from './test-communities'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = testEnv(platform.env)

let owner = ''
let bob = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetCommunities(db)
  owner = await signIn(env)
  bob = await signIn(env, 'bob', { id: '2' })
})
afterAll(() => platform.dispose())

const settings = async (cookie: string) =>
  (
    await (
      await server.fetch(
        new Request(`${TEST_ORIGIN}/settings`, { headers: { Cookie: cookie } }),
        env,
      )
    ).text()
  ).replace(/\s+/g, ' ')

test('F30-AC35: F30-AC34: Given communities a person runs, When their settings open, Then each is listed with the admin mark and "edit community"', async () => {
  await seedCommunity(db, {
    id: 1,
    handle: 'kanagawapm',
    name: 'Kanagawa.pm',
    links: ['https://kanagawapm.connpass.com/'],
    creator: OWNER_ID,
  })
  await seedCommunity(db, {
    id: 2,
    handle: 'hono',
    name: 'Hono',
    links: ['https://hono.connpass.com/'],
    creator: '2',
  })
  const body = await settings(owner)
  expect(body).toContain('<h2>管理しているコミュニティ</h2>')
  expect(body).toContain('href="/@kanagawapm/edit"')
  expect(body).toContain(
    '<span class="visually-hidden">管理者</span></span > Kanagawa.pm',
  )
  expect(body).not.toContain('/@hono/edit')
})

test('F30-AC35: Given a person who runs none, When their settings open, Then the frame says so', async () => {
  expect(await settings(bob)).toContain(
    '管理しているコミュニティはありません。',
  )
})
