import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'
import { japaneseOutside } from '../site/test-japanese'
import {
  resetTables,
  seedDeck,
  seedDeployment,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await seedDeck(db, 'talk')
})
afterAll(() => platform.dispose())

const english = { 'Accept-Language': 'en' }

test('Given the upload receipt page in English, When opened, Then the page and its script messages are English', async () => {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/uploads/x`, { headers: english }),
    env,
  )
  const page = await response.text()
  expect(page).toContain('<html lang="en">')
  expect(page).toContain('<title>Slide upload receipt</title>')
  expect(japaneseOutside(page)).toEqual([])
  // Script text is skipped by japaneseOutside; its messages are checked here.
  const script = /<script>([\s\S]*?)<\/script>/.exec(page)?.[1] ?? ''
  expect(script).toContain('"checking":"Checking…"')
  expect(script).not.toMatch(
    /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  )
})

test('Given the upload receipt page in Japanese, When opened, Then its script messages are Japanese', async () => {
  const page = await (
    await server.fetch(new Request(`${TEST_ORIGIN}/uploads/x`), env)
  ).text()
  expect(page).toContain('<title>Slide アップロード受領票</title>')
  expect(page).toContain('"checking":"確認しています…"')
})

test('Given an author in English, When they open a version as the author, Then the launch page names English for the deployment origin', async () => {
  const cookie = await signIn(env)
  const id = await seedDeployment(db, 'talk')
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/decks/talk/deployments/${id}/preview`, {
      method: 'POST',
      headers: {
        ...english,
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: '',
    }),
    env,
  )
  const page = await response.text()
  expect(page).toContain('<html lang="en">')
  expect(page).toContain(
    `action="https://d-${id}.content.example/_preview/launch?lang=en"`,
  )
  expect(japaneseOutside(page)).toEqual([])
})

test.each([
  ['POST', '/_preview/launch?lang=en', {}, 403],
  ['POST', '/_preview/launch', english, 403],
] as const)(
  'Given %s %s on a deployment origin without a usable session, When answered, Then the reopen notice is English',
  async (method, path, headers, status) => {
    const id = await seedDeployment(db, 'talk')
    const response = await server.fetch(
      new Request(`https://d-${id}.content.example${path}`, {
        method,
        headers: {
          ...headers,
          ...(method === 'POST'
            ? { 'Content-Type': 'application/x-www-form-urlencoded' }
            : {}),
        },
        body: method === 'POST' ? 'token=x' : undefined,
      }),
      env,
    )
    expect(response.status).toBe(status)
    const page = await response.text()
    expect(page).toContain('<html lang="en">')
    expect(page).toContain('your dashboard')
    expect(japaneseOutside(page)).toEqual([])
  },
)

test.each([
  ['/?lang=en', {}],
  ['/', english],
] as const)(
  'Given an unknown author-only session, When %s is opened with %j, Then the reopen notice is English',
  async (path, headers) => {
    const id = await seedDeployment(db, 'talk')
    const response = await server.fetch(
      new Request(`https://d-${id}.content.example${path}`, {
        headers: {
          ...headers,
          Cookie: `__Host-slide_preview=${'a'.repeat(43)}`,
        },
      }),
      env,
    )
    expect(response.status).toBe(401)
    const page = await response.text()
    expect(page).toContain('<html lang="en">')
    expect(japaneseOutside(page)).toEqual([])
  },
)

test('Given no language on a deployment origin, When the reopen notice is shown, Then it is Japanese', async () => {
  const id = await seedDeployment(db, 'talk')
  const page = await (
    await server.fetch(
      new Request(`https://d-${id}.content.example/_preview/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'token=x',
      }),
      env,
    )
  ).text()
  expect(page).toContain('<html lang="ja">')
  expect(page).toContain('管理画面')
})
