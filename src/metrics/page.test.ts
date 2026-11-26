import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/d1'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { metricDaily, metricDays } from '../db/schema'
import { placeFiles } from '../exports/test-upload'
import { ACCESS_TOKEN_HEADER } from '../operator/access'
import {
  accessTeam,
  AUDIENCE,
  OPERATOR_ORIGIN,
  TEAM,
} from '../operator/test-support'
import {
  resetTables,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { addDays, dayOf } from './day'
import { lastWeeks } from './weeks'

vi.setConfig({ testTimeout: 60_000 })

const team = await accessTeam()
// The keys come from the stand-in team instead of the network.
vi.mock('../operator/access-client', () => ({ accessKeys: () => team.keys }))

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const ACCOUNT = '0123456789abcdef0123456789abcdef'
const configured = {
  ANALYTICS: { writeDataPoint() {} },
  ANALYTICS_READ_TOKEN: 'read-token-0123456789',
  ANALYTICS_ACCOUNT_ID: ACCOUNT,
}
const base = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  OPERATOR_ORIGIN,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUDIENCE,
  UPLOAD_LIMITS: { activeSessions: 20, startsPerDay: 1000, files: 500 },
} as unknown as Env
const env = { ...base, ...configured } as unknown as Env

beforeAll(() => applyMigrations(database), 60_000)
beforeEach(async () => {
  await resetTables(database)
  await db.delete(metricDaily)
  await db.delete(metricDays)
}, 30_000)
afterAll(() => platform.dispose())

const admin = async (path: string, token?: string, target: Env = env) =>
  server.fetch(
    new Request(`${OPERATOR_ORIGIN}${path}`, {
      headers: token ? { [ACCESS_TOKEN_HEADER]: token } : {},
    }),
    target,
  )

const NOW = Math.floor(Date.now() / 1000)
const weeks = lastWeeks(NOW)

/** Twelve weeks of counts: week i has i + 1 logins sent and i accepted. */
async function seedTwelveWeeks() {
  for (const [index, week] of weeks.entries()) {
    await db.insert(metricDaily).values([
      {
        day: week.start,
        event: 'login_code_sent',
        detail: '',
        referrer: '',
        lang: 'ja',
        screen: '',
        events: index + 1,
        value_sum: 0,
      },
      {
        day: week.start,
        event: 'login_code_entered',
        detail: 'accepted',
        referrer: '',
        lang: 'ja',
        screen: '',
        events: index,
        value_sum: 0,
      },
    ])
  }
  await db.insert(metricDays).values({
    day: dayOf(NOW - 86400),
    copied_at: NOW,
    row_count: 24,
    was_cut: 0,
  })
}

test('F40-AC18, F40-AC19: Given twelve weeks of counts in D1, When the operator opens the page, Then the table shows each week with the counts and the shares', async () => {
  await seedTwelveWeeks()
  const response = await admin('/metrics', await team.sign())
  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Security-Policy')).toContain(
    "default-src 'none'",
  )
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  const page = (await response.text()).replace(/\s+/g, ' ')
  expect(page).toContain('<h2>週ごとの数</h2>')
  // The newest week: 12 sent and 11 accepted, which is 92%.
  expect(page).toContain('<span class="n">12</span>')
  expect(page).toContain(
    '<span class="n">11</span> <span class="n">(92%)</span>',
  )
  // The oldest: 1 sent and none accepted.
  expect(page).toContain('<span class="n">1</span>')
  expect(page).toContain('<span class="n">0</span> <span class="n">(0%)</span>')
  expect(page).toContain(`最後に写した日: ${dayOf(NOW - 86400)}`)
  // Everything is set, so there is no note.
  expect(page).not.toContain('未設定')
})

test('F40-AC18: Given counts outside the twelve weeks, When the page is opened, Then they are not in the table', async () => {
  await db.insert(metricDaily).values({
    day: addDays(weeks[0]!.start, -1),
    event: 'login_code_sent',
    detail: '',
    referrer: '',
    lang: 'ja',
    screen: '',
    events: 777,
    value_sum: 0,
  })
  const page = await (await admin('/metrics', await team.sign())).text()
  expect(page).not.toContain('777')
})

test('F40-AC18: Given the languages of one event on a day, When the page is opened, Then they are added into one count', async () => {
  const day = dayOf(NOW - 86400)
  for (const lang of ['ja', 'en'] as const)
    await db.insert(metricDaily).values({
      day,
      event: 'oembed_served',
      detail: '',
      referrer: '',
      lang,
      screen: '',
      events: 5,
      value_sum: 0,
    })
  const csv = await (await admin('/metrics.csv', await team.sign())).text()
  expect(csv).toMatch(/埋め込みの方法を答えた数,(0,)*10\r\n/)
})

test('D-72, F40-AC18: Given authors who put slides up in different weeks, When the page is opened, Then the authors per week are counted from D1 itself, exactly', async () => {
  const alice = await signIn(base, 'alice')
  const bob = await signIn(base, 'bob', { id: '1234' })
  await placeFiles(base, alice, {
    'index.html': '<!doctype html><title>a</title>',
  })
  await placeFiles(base, alice, {
    'index.html': '<!doctype html><title>b</title>',
  })
  await placeFiles(base, bob, {
    'index.html': '<!doctype html><title>c</title>',
  })
  const csv = await (await admin('/metrics.csv', await team.sign())).text()
  // Two authors and three versions this week; the count is of people.
  expect(csv).toContain(
    '使われているか,スライドを置いた作者の数(D1 から数えた値),0,0,0,0,0,0,0,0,0,0,0,2\r\n',
  )
})

test('F40-AC20: Given counts, When the operator asks for the CSV, Then it is the table of the page as a download, in UTF-8 with a byte order mark', async () => {
  await seedTwelveWeeks()
  const response = await admin('/metrics.csv', await team.sign())
  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
  expect(response.headers.get('Content-Disposition')).toBe(
    `attachment; filename="metrics-${dayOf(NOW)}.csv"`,
  )
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  const bytes = new Uint8Array(await response.clone().arrayBuffer())
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  // `text()` drops the mark, as a spreadsheet does once it has read it.
  const csv = await response.text()
  const lines = csv.split('\r\n')
  expect(lines[0]?.split(',')).toEqual([
    '区分',
    '項目',
    ...weeks.map((week) => week.start),
  ])
  expect(lines).toContain(
    'どこで詰まるか,ログインのコードを送った数,1,2,3,4,5,6,7,8,9,10,11,12',
  )
  expect(lines).toContain(
    'どこで詰まるか,コードが入れられた数(合っていた),0,1,2,3,4,5,6,7,8,9,10,11',
  )
  // The same numbers as the page, week by week.
  const rowsOnPage = (
    (await (await admin('/metrics', await team.sign())).text()).match(
      /<th scope="row">/g,
    ) ?? []
  ).length
  const rowsInCsv =
    lines.filter((line) => line !== '' && !line.includes('(割合 %)')).length - 1
  expect(rowsInCsv).toBe(rowsOnPage)
})

test.each(['/metrics', '/metrics.csv'])(
  'F40-AC21: Given no token, a forged one or an expired one, When %s is opened, Then the answer is the one a missing page gets, and no number is in it',
  async (path) => {
    await seedTwelveWeeks()
    const token = await team.sign()
    const missing = await admin('/no-such-page', token)
    const expected = { status: missing.status, body: await missing.text() }
    const expired = await team.sign({}, { expiresAt: 1 })
    for (const presented of [undefined, `${token.slice(0, -4)}AAAA`, expired]) {
      const response = await admin(path, presented)
      expect({ status: response.status, body: await response.text() }).toEqual(
        expected,
      )
    }
  },
)

test.each(['/metrics', '/metrics.csv'])(
  'F40-AC21: Given the management origin or a deployment origin, When %s is asked for with a verified token, Then no operator page and no CSV answers',
  async (path) => {
    await seedTwelveWeeks()
    const token = await team.sign()
    const management = await server.fetch(
      new Request(`${TEST_ORIGIN}${path}`, {
        headers: { [ACCESS_TOKEN_HEADER]: token },
      }),
      env,
    )
    const text = await management.text()
    expect(text).not.toContain('op@example.com')
    expect(text).not.toContain('区分,項目')
    const deployment = await server.fetch(
      new Request(
        `https://d-7ae11c67-633f-4f21-b2b1-80af84107428.content.example${path}`,
        {
          headers: { [ACCESS_TOKEN_HEADER]: token },
        },
      ),
      env,
    )
    expect(deployment.status).toBe(404)
  },
)

test('F40-AC21: Given the CSV, When a change is posted to it, Then it is not a route that changes anything', async () => {
  const response = await server.fetch(
    new Request(`${OPERATOR_ORIGIN}/metrics.csv`, {
      method: 'POST',
      headers: {
        [ACCESS_TOKEN_HEADER]: await team.sign(),
        Origin: OPERATOR_ORIGIN,
      },
    }),
    env,
  )
  expect(response.status).toBe(404)
})

test('F40-AC22: Given no dataset bound, When the page is opened, Then it says ANALYTICS is not set, and still shows what D1 holds', async () => {
  await seedTwelveWeeks()
  const bare = { ...env, ANALYTICS: undefined } as unknown as Env
  const response = await admin('/metrics', await team.sign(), bare)
  expect(response.status).toBe(200)
  const page = (await response.text()).replace(/\s+/g, ' ')
  expect(page).toContain('未設定:')
  expect(page).toContain('<code>ANALYTICS</code>')
  expect(page).not.toContain('<code>ANALYTICS_READ_TOKEN</code>')
  expect(page).toContain('<code>docs/dev/metrics-setup.md</code>')
  expect(page).toContain('<span class="n">12</span>')
})

test('F40-AC23: Given no read token, When the page is opened, Then it says the token and, if it is the one missing, the account, and the CSV still comes', async () => {
  await seedTwelveWeeks()
  const noToken = {
    ...env,
    ANALYTICS_READ_TOKEN: undefined,
    ANALYTICS_ACCOUNT_ID: undefined,
  } as unknown as Env
  const page = await (
    await admin('/metrics', await team.sign(), noToken)
  ).text()
  expect(page).toContain('<code>ANALYTICS_READ_TOKEN</code>')
  expect(page).toContain('<code>ANALYTICS_ACCOUNT_ID</code>')
  expect((await admin('/metrics.csv', await team.sign(), noToken)).status).toBe(
    200,
  )
})

test('F40-AC22: Given an empty D1 and nothing set, When the page and the CSV are opened, Then both answer with a table of zeros and no error', async () => {
  const bare = { ...base } as unknown as Env
  const page = await admin('/metrics', await team.sign(), bare)
  expect(page.status).toBe(200)
  const csv = await admin('/metrics.csv', await team.sign(), bare)
  expect(csv.status).toBe(200)
  expect((await csv.text()).split('\r\n').length).toBeGreaterThan(30)
})

test('F40-AC15, F40-AC18: Given the page and the CSV with counts, When they are read, Then no row holds an address or a person’s number', async () => {
  await seedTwelveWeeks()
  const token = await team.sign()
  const text = `${await (await admin('/metrics', token)).text()}${await (await admin('/metrics.csv', token)).text()}`
  expect(text).not.toMatch(/\d{1,3}(\.\d{1,3}){3}/)
  expect(text).not.toMatch(
    /[A-Za-z0-9._-]+@(?!example)[A-Za-z0-9.-]+\.[a-z]{2,}/,
  )
})
