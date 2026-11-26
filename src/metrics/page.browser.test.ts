import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import type { Browser } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { metricDaily, metricDays } from '../db/schema'
import { ACCESS_TOKEN_HEADER } from '../operator/access'
import {
  accessTeam,
  AUDIENCE,
  OPERATOR_ORIGIN,
  TEAM,
} from '../operator/test-support'
import { testEnv } from '../publication/test-support'
import { openTestBrowser } from '../test-open-browser'
import { dayOf } from './day'
import { lastWeeks } from './weeks'

const team = await accessTeam()
vi.mock('../operator/access-client', () => ({ accessKeys: () => team.keys }))

const platform = await getPlatformProxy<Env>({ persist: false })
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  OPERATOR_ORIGIN,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUDIENCE,
  // Everything is set but the token, so the note shows in the page too.
  ANALYTICS: { writeDataPoint() {} },
} as unknown as Env

let browser: Browser
beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  const db = drizzle(platform.env.DB)
  const now = Math.floor(Date.now() / 1000)
  // Twelve weeks of counts of the kinds the table has, with long names.
  const line = (
    day: string,
    event: string,
    detail: string,
    events: number,
    extra: Partial<typeof metricDaily.$inferInsert> = {},
  ) => ({
    day,
    event,
    detail,
    referrer: '',
    lang: 'ja' as const,
    screen: '',
    events,
    value_sum: 0,
    ...extra,
  })
  const rows = lastWeeks(now).flatMap((week, i) => [
    line(week.start, 'login_code_sent', '', 40 + i),
    line(week.start, 'login_code_entered', 'accepted', 31 + i),
    line(week.start, 'upload_started', '', 22000 + i),
    line(week.start, 'upload_finished', '', 19000 + i),
    line(week.start, 'deck_published', '', 9, { value_sum: 9 * 600 }),
    line(week.start, 'deck_opened', 'page', 1234 + i, {
      referrer: 'a-very-long-host-name.example.co.jp',
    }),
    line(week.start, 'help_search_empty', 'ふつうのことばでさがす', 3),
  ])
  // D1 takes 100 values in one statement.
  for (let i = 0; i < rows.length; i += 10)
    await db.insert(metricDaily).values(rows.slice(i, i + 10))
  await db.insert(metricDays).values({
    day: dayOf(now - 86400),
    copied_at: now,
    row_count: rows.length,
    was_cut: 0,
  })
  browser = await openTestBrowser()
}, 120_000)
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

async function open(width: number) {
  const page = await browser.newPage({ viewport: { width, height: 800 } })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== OPERATOR_ORIGIN) return route.abort()
    const response = await server.fetch(
      new Request(url, {
        headers: { [ACCESS_TOKEN_HEADER]: await team.sign() },
      }),
      env,
    )
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  await page.goto(`${OPERATOR_ORIGIN}/metrics`)
  await page.getByRole('heading', { level: 1, name: '計測' }).waitFor()
  return page
}

test('F40-AC25: Given the metrics page at 375 px wide, When it is opened, Then the page does not scroll sideways and only the box of the table does', async () => {
  const page = await open(375)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(0)
  const box = await page.evaluate(() => {
    const scroll = document.querySelector('.table-scroll')
    return scroll && { client: scroll.clientWidth, scroll: scroll.scrollWidth }
  })
  expect(box).not.toBeNull()
  expect(box!.scroll).toBeGreaterThan(box!.client)
  // The box fits the screen; the table inside it is what is wider.
  expect(box!.client).toBeLessThanOrEqual(375)
  await page.close()
}, 60_000)

test('F40-AC25: Given the metrics page at 1280 px wide, When it is opened, Then nothing scrolls sideways and every row is headed', async () => {
  const page = await open(1280)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(0)
  const headings = await page
    .locator('.metrics-table tbody th[scope="row"]')
    .count()
  expect(headings).toBeGreaterThan(30)
  const cellsPerRow = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '.metrics-table tbody tr:has(th[scope="row"])',
      ),
    ].every((row) => row.children.length === 13),
  )
  expect(cellsPerRow).toBe(true)
  await page.close()
}, 60_000)

test('F40-AC19, F40-AC25: Given the metrics page, When it is read as a table, Then the numbers sit to the right and the shares are in parentheses', async () => {
  const page = await open(1280)
  const align = await page.evaluate(() => {
    const cell = document.querySelector('.metrics-table tbody td')
    return cell && getComputedStyle(cell).textAlign
  })
  expect(align).toBe('right')
  expect(
    await page.locator('.metrics-table td', { hasText: /\(\d+%\)/ }).count(),
  ).toBeGreaterThan(0)
  await page.close()
}, 60_000)
