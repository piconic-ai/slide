import { mkdir } from 'node:fs/promises'
import { openTestBrowser } from '../test-open-browser'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import type { Browser } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { ACCESS_TOKEN_HEADER } from '../operator/access'
import {
  accessTeam,
  AUDIENCE,
  OPERATOR_ORIGIN,
  TEAM,
} from '../operator/test-support'
import { testEnv } from '../publication/test-support'
import { runBackup } from './backup-routes'
import { openBuckets } from './test-buckets'

const team = await accessTeam()
vi.mock('../operator/access-client', () => ({ accessKeys: () => team.keys }))

const service = await getPlatformProxy<Env>({ persist: false })
const buckets = await openBuckets()
const baseEnv = {
  ...testEnv(service.env),
  CONTENT_ORIGIN: 'https://content.example',
  OPERATOR_ORIGIN,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUDIENCE,
}
const configured = {
  ...baseEnv,
  UPLOADS_BACKUP: buckets.env.UPLOADS_BACKUP,
} as unknown as Env
const unset = { ...baseEnv, UPLOADS_BACKUP: undefined } as unknown as Env

/** Where the screenshots go when a person asks for them (verify-slide). */
const EVIDENCE = process.env.BACKUP_EVIDENCE_DIR

let browser: Browser
beforeAll(async () => {
  await applyMigrations(service.env.DB)
  for (const key of ['d1/0/index.html', 'd1/1/style.css', 'avatars/u1'])
    await service.env.UPLOADS.put(key, key)
  await runBackup(configured, Date.UTC(2026, 10, 26, 18, 17) / 1000)
  browser = await openTestBrowser()
})
afterAll(async () => {
  await browser?.close()
  await service.dispose()
  await buckets.dispose()
})

/** The operator host in a real browser, its requests answered by the Worker, with the token Cloudflare Access would attach. */
async function open(width: number, env: Env) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
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
  return page
}

test.each([
  ['configured', configured],
  ['not set up', unset],
])(
  'F39-AC30 and F39-AC32: Given a backup that is %s, When the operations page is opened at 1280 and 375 px wide, Then the backup frame is there and the page does not scroll sideways',
  async (name, env) => {
    for (const width of [1280, 375]) {
      const page = await open(width, env)
      await page.goto(`${OPERATOR_ORIGIN}/operations`)
      const frame = page.locator('#backups')
      await frame
        .getByRole('heading', { level: 2, name: 'バックアップ' })
        .waitFor()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      )
      expect(overflow, `${name} at ${width}`).toBeLessThanOrEqual(0)
      if (name === 'configured')
        // What a reader sees: at 375 px the row's label is the cell's own.
        expect(await frame.innerText()).toContain('最後に写した日時')
      else expect(await frame.getByText('未設定').isVisible()).toBe(true)
      if (EVIDENCE) {
        await mkdir(EVIDENCE, { recursive: true })
        await frame.screenshot({
          path: `${EVIDENCE}/backups-${name.replaceAll(' ', '-')}-${width}.png`,
        })
        await page.screenshot({
          path: `${EVIDENCE}/operations-${name.replaceAll(' ', '-')}-${width}.png`,
          fullPage: true,
        })
      }
      await page.close()
    }
  },
  30000,
)
