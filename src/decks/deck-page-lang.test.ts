import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { deployments, uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { HISTORY_PAGE_SIZE } from './history-store'
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

let cookie = ''
let revision = 0
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await seedDeck(db, 'talk')
  cookie = await signIn(env)
  revision = 0
})
afterAll(() => platform.dispose())

const english = { 'Accept-Language': 'en' }

const open = async (query = '', environment = env) => {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/slides/talk${query}`, {
      headers: { ...english, Cookie: cookie },
    }),
    environment,
  )
  expect(response.status).toBe(200)
  return response.text()
}

async function act(fields: Record<string, string>) {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/slides/talk/publication`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        ...fields,
        expectedRevision: String(revision),
      }).toString(),
    }),
    env,
  )
  expect(response.status).toBe(303)
  revision++
}

const expectEnglish = (page: string) => {
  expect(page).toContain('<html lang="en">')
  expect(japaneseOutside(page)).toEqual([])
}

test('Given drafts in every state, When the deck page opens in English, Then its versions and panel are English', async () => {
  await seedDeployment(db, 'talk')
  await seedDeployment(db, 'talk', 'uploading')
  const failed = await seedDeployment(db, 'talk', 'failed')
  await drizzle(db)
    .update(deployments)
    .set({ failure_reason: 'too_many_files' })
    .where(eq(deployments.id, failed))
  await seedDeployment(db, 'talk', 'expired')
  const page = await open()
  expectEnglish(page)
  expect(page).toContain('Not published yet')
  expect(page).toContain('Not published yet')
  expect(page).toContain('‹ Your slides')
  expect(page).toContain('Drop a new version')
  expect(page).not.toContain('Embed code')
  expect(page).toContain('Delete slides')
})

test('Given a public version and a newer one, When the page opens in English, Then both version rows and the share link are English', async () => {
  const older = await seedDeployment(db, 'talk')
  const newer = await seedDeployment(db, 'talk')
  await db
    .prepare('UPDATE deployments SET ready_at = 50 WHERE id = ?')
    .bind(newer)
    .run()
  await act({ action: 'publish', deploymentId: older })
  const page = await open('?result=applied')
  expectEnglish(page)
  expect(page).toContain('Public')
  expect(page).toContain('data-copied="Copied"')
  expect(page).toContain('Version readers see')
  expect(page).toContain('New version, not published yet')
  expect(page).toContain('Publish this version')
  expect(page).toContain('Received on')
})

test('Given drafts only, When publishing is paused and the page opens in English, Then it says resuming leaves drafts', async () => {
  await seedDeployment(db, 'talk')
  await act({ action: 'pause' })
  const page = await open()
  expectEnglish(page)
  expect(page).toContain('Publishing is stopped')
})

test.each([
  'applied',
  'unchanged',
  'conflict',
  'not_paused',
  'not_publishable',
  'invalid',
])(
  'Given the result %s, When the page opens in English, Then it is reported in English',
  async (result) => {
    expectEnglish(await open(`?result=${result}`))
  },
)

test('Given a paused deck, When the page opens in English, Then the row to publish again is English', async () => {
  const version = await seedDeployment(db, 'talk')
  await act({ action: 'publish', deploymentId: version })
  await act({ action: 'pause' })
  const page = await open('?result=conflict')
  expectEnglish(page)
  expect(page).toContain('Publish again')
  expect(page).toContain('Publishing is stopped')
})

test('Given no content domain, When the page opens in English, Then the note about it is English', async () => {
  await seedDeployment(db, 'talk')
  expectEnglish(
    await open('', { ...env, CONTENT_ORIGIN: '' } as unknown as Env),
  )
})

test.each([
  ['GET', '/slides/missing'],
  ['GET', '/slides/BAD!'],
  ['POST', '/slides/BAD!/delete'],
  ['POST', '/slides/missing/delete'],
])(
  'Given %s %s, When answered in English, Then the not-found page is English',
  async (method, path) => {
    const response = await server.fetch(
      new Request(`${TEST_ORIGIN}${path}`, {
        method,
        headers: {
          ...english,
          Cookie: cookie,
          ...(method === 'POST'
            ? {
                Origin: TEST_ORIGIN,
                'Content-Type': 'application/x-www-form-urlencoded',
              }
            : {}),
        },
        ...(method === 'POST' ? { body: 'confirm=missing' } : {}),
      }),
      env,
    )
    expect(response.status).toBe(404)
    const page = await response.text()
    expectEnglish(page)
    expect(page).toContain('<title>Not found - Slide</title>')
  },
)

test('Given a mistyped deck name, When deleting in English, Then the refusal is English', async () => {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/slides/talk/delete`, {
      method: 'POST',
      headers: {
        ...english,
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'confirm=wrong',
    }),
    env,
  )
  expect(response.status).toBe(400)
  const page = await response.text()
  expectEnglish(page)
  expect(page).toContain('Nothing was deleted')
})
