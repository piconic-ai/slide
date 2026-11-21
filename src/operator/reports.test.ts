import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { accounts } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { deckIdSchema } from '../decks/deck-id'
import {
  OWNER_ID,
  resetTables,
  seedDeck,
  testEnv,
} from '../publication/test-support'
import { saveReport } from '../reports/store'
import { ACCESS_TOKEN_HEADER } from './access'
import { accessTeam, AUDIENCE, OPERATOR_ORIGIN, TEAM } from './test-support'

const team = await accessTeam()
vi.mock('./access-client', () => ({ accessKeys: () => team.keys }))

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  OPERATOR_ORIGIN,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUDIENCE,
} as unknown as Env

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  await drizzle(database)
    .insert(accounts)
    .values([
      { user_id: OWNER_ID, handle: 'owner', created_at: 1 },
      { user_id: 'reader-id-one', handle: 'reader-handle-one', created_at: 1 },
      { user_id: 'reader-id-two', handle: 'reader-handle-two', created_at: 1 },
    ])
  await seedDeck(database, 'a-older')
  await seedDeck(database, 'z-newer')
})
afterAll(() => platform.dispose())

const open = (token?: string, path = '/') =>
  server.fetch(
    new Request(`${OPERATOR_ORIGIN}${path}`, {
      headers: token ? { [ACCESS_TOKEN_HEADER]: token } : {},
    }),
    env,
  )

async function seedReports() {
  await saveReport(database, {
    deckId: deckIdSchema.parse('a-older'),
    deploymentId: 'version-one',
    sharePath: '/@owner/a-older',
    reason: 'other',
    note: '確認をお願いします。',
    reporterUserId: 'reader-id-one',
    now: 100,
  })
  await saveReport(database, {
    deckId: deckIdSchema.parse('z-newer'),
    deploymentId: 'version-two',
    sharePath: '/@owner/z-newer',
    reason: 'nuisance',
    note: '',
    reporterUserId: 'reader-id-one',
    now: 200,
  })
  await saveReport(database, {
    deckId: deckIdSchema.parse('z-newer'),
    deploymentId: 'version-two',
    sharePath: '/@owner/z-newer/3',
    reason: 'rights',
    note: '<script>alert(1)</script>',
    reporterUserId: 'reader-id-two',
    now: 300,
  })
}

test('F17-AC17: Given reports and a valid Access token, When the operator opens home, Then decks, counts, labels, notes and times appear newest first without reporter identities', async () => {
  await seedReports()

  const response = await open(await team.sign())
  const page = await response.text()

  expect(response.status).toBe(200)
  expect(page).toContain('通報されたスライド（2 件）')
  expect(page).toMatch(
    /@owner\/z-newer<\/code><\/td>\s*<td><span class="cell-label">人数<\/span>2<\/td>/,
  )
  expect(page).toMatch(
    /@owner\/a-older<\/code><\/td>\s*<td><span class="cell-label">人数<\/span>1<\/td>/,
  )
  expect(page.indexOf('@owner/z-newer')).toBeLessThan(
    page.indexOf('@owner/a-older'),
  )
  expect(page).toContain('迷惑行為')
  expect(page).toContain('権利侵害')
  expect(page).toContain('その他')
  expect(page).toContain('確認をお願いします。')
  expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  expect(page).not.toContain('<script>alert(1)</script>')
  expect(page.indexOf('権利侵害')).toBeLessThan(page.indexOf('迷惑行為'))
  expect(page).toContain('1970-01-01T00:03:20.000Z')
  expect(page.match(/1970-01-01T00:05:00\.000Z/g)).toHaveLength(2)
  expect(page.match(/1970-01-01T00:01:40\.000Z/g)).toHaveLength(2)
  expect(page.indexOf('通報されたスライド')).toBeLessThan(
    page.indexOf('非表示にしているスライド'),
  )
  for (const secret of [
    'reader-id-one',
    'reader-id-two',
    'reader-handle-one',
    'reader-handle-two',
    'reporter_user_id',
    'reporterUserId',
  ])
    expect(page).not.toContain(secret)
})

test('F17-AC17: Given no reports and a valid Access token, When the operator opens home, Then the empty message appears', async () => {
  const response = await open(await team.sign())
  const page = await response.text()

  expect(response.status).toBe(200)
  expect(page).toContain('通報されたスライド（0 件）')
  expect(page).toContain('通報されたスライドはありません。')
})

test('F17-AC17: Given stored reports and no valid Access token, When home is requested, Then it answers exactly like a missing page', async () => {
  await seedReports()
  const missing = await open(await team.sign(), '/no-such-page')
  const missingBody = await missing.text()
  expect(missing.status).toBe(404)

  for (const token of [
    undefined,
    'x.y.z',
    await team.sign({}, { expiresAt: 1 }),
  ]) {
    const response = await open(token)
    expect(response.status).toBe(missing.status)
    expect(await response.text()).toBe(missingBody)
  }
})
