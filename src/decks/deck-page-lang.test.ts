import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { deployments } from '../db/schema'
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
    new Request(`${TEST_ORIGIN}/decks/talk${query}`, {
      headers: { ...english, Cookie: cookie },
    }),
    environment,
  )
  expect(response.status).toBe(200)
  return response.text()
}

async function act(fields: Record<string, string>) {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/decks/talk/publication`, {
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

test('Given drafts in every state, When the deck page opens in English, Then its history and panel are English', async () => {
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
  expect(page).toContain('Drafts only')
  expect(page).toContain('More files than one version may have')
  expect(page).toContain('Upload history')
})

test('Given a public version and a newer one, When the page opens in English, Then the replacement warning and share link are English', async () => {
  const older = await seedDeployment(db, 'talk')
  await seedDeployment(db, 'talk')
  await act({ action: 'publish', deploymentId: older })
  const page = await open('?result=applied')
  expectEnglish(page)
  expect(page).toContain('Public:')
  expect(page).toContain('data-copied="Copied"')
  expect(page).toContain('The public version is replaced')
})

test('Given a paused deck, When the page opens in English, Then the resume target and mode switch are English', async () => {
  const version = await seedDeployment(db, 'talk')
  await act({ action: 'publish', deploymentId: version })
  await act({ action: 'pause' })
  await act({ action: 'set_mode', mode: 'repository' })
  const page = await open('?result=conflict')
  expectEnglish(page)
  expect(page).toContain('Public on resume')
  expect(page).toContain('Switch to Manual publishing')
})

test('Given no content domain, When the page opens in English, Then the note about it is English', async () => {
  await seedDeployment(db, 'talk')
  expectEnglish(
    await open('', { ...env, CONTENT_ORIGIN: '' } as unknown as Env),
  )
})

test.each([
  ['/decks/missing', 404],
  ['/decks/BAD!', 404],
])(
  'Given %s, When opened in English, Then the not-found page is English',
  async (path, status) => {
    const response = await server.fetch(
      new Request(`${TEST_ORIGIN}${path}`, {
        headers: { ...english, Cookie: cookie },
      }),
      env,
    )
    expect(response.status).toBe(status)
    expectEnglish(await response.text())
  },
)

test('Given a mistyped deck name, When deleting in English, Then the refusal is English', async () => {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/decks/talk/delete`, {
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
