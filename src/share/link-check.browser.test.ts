import { openTestBrowser } from '../test-open-browser'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { keepArticle } from '../articles/store'
import { applyMigrations } from '../db/test-migrations'
import { parseLinkInput } from '../links/link'
import { addLink } from '../links/store'
import {
  OWNER_ID,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

/** The engine, chosen with BROWSER as in viewer.browser.test.ts. */
const engineName = process.env.BROWSER ?? 'chromium'
const engine = { chromium, webkit, firefox }[engineName]
if (!engine) throw new Error(`Unknown BROWSER: ${engineName}`)

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

const ELSEWHERE = 'https://elsewhere.example'
/** A related link as the author added it, and the address it leads to. */
const ADDED = `${ELSEWHERE}/talk/?utm_source=x&b=1&fbclid=y#Top`
const SANITIZED = `${ELSEWHERE}/talk/?b=1#Top`
/** A related link of a long address, for a narrow screen. */
const LONG = `${ELSEWHERE}/${'segment-'.repeat(30)}end?q=${'v'.repeat(80)}`
const ARTICLE = [
  `[外の記事](${ELSEWHERE}/post?utm_source=x&b=1)`,
  `[古いサイト](http://elsewhere.example/old?fbclid=y)`,
  `[メール](mailto:hello@elsewhere.example)`,
  `[共有 URL](${TEST_ORIGIN}/@owner/other)`,
  `${TEST_ORIGIN}/@owner/talk/2`,
].join('\n\n')

let browser: Browser
beforeAll(async () => {
  await applyMigrations(db)
  await signIn(env)
  await seedPublic(db, 'talk', 100, 'Talk')
  await seedPublic(db, 'other', 100, 'Other')
  for (const url of [ADDED, LONG]) {
    const parsed = parseLinkInput({ url, title: '' })
    if (!parsed.ok) throw new Error(parsed.reason)
    await addLink(db, {
      deckId: 'talk',
      ownerUserId: OWNER_ID,
      link: parsed.link,
      now: 1,
    })
  }
  await keepArticle(db, {
    deckId: 'talk',
    body: ARTICLE,
    status: 'published',
    citations: [],
    now: 5,
  })
  browser = await openTestBrowser(engine)
}, 30_000)
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

const SETTLE = { timeout: 10000 }
/** A test opens a browser context or two and may follow a link. */
const TIMEOUT = 30_000

type Opened = Readonly<{
  page: Page
  /** Every request for another site, with the Referer it carried. */
  away: { url: string; referer: string | null }[]
  /** The CSP violations the viewer reported. */
  violations: () => Promise<string[]>
}>

/** The viewer of the slides, answered by the Worker; other sites answer a blank page. */
async function open(
  options: BrowserContextOptions = {},
  path = '/@owner/talk',
): Promise<Opened> {
  // Tall enough that every link is on screen: the viewer moves the focus
  // to the slides once they load, which scrolls the page back up under a
  // press that had to scroll down first.
  const context = await browser.newContext({
    locale: 'ja-JP',
    viewport: { width: 1280, height: 1600 },
    ...options,
  })
  await context.addInitScript(() => {
    const seen: string[] = []
    ;(window as unknown as { cspSeen: string[] }).cspSeen = seen
    document.addEventListener('securitypolicyviolation', (event) =>
      seen.push(`${event.violatedDirective} ${event.blockedURI}`),
    )
  })
  const away: Opened['away'] = []
  await context.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === ELSEWHERE || url.href.startsWith('http://elsewhere.')) {
      away.push({ url: url.href, referer: request.headers().referer ?? null })
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<title>elsewhere</title><p>elsewhere</p>',
      })
    }
    if (url.origin !== TEST_ORIGIN) return route.abort()
    const response = await server.fetch(
      new Request(url, {
        method: request.method(),
        headers: await request.allHeaders(),
        redirect: 'manual',
      }),
      env,
    )
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  const page = await context.newPage()
  await page.goto(`${TEST_ORIGIN}${path}`)
  // The page settles first, so a press lands where the link is drawn.
  await page.waitForLoadState('networkidle')
  return {
    page,
    away,
    violations: () =>
      page
        .evaluate(() => (window as unknown as { cspSeen: string[] }).cspSeen)
        .catch(() => []),
  }
}

const DIALOG = '.link-check[role="dialog"]'
const relatedLink = (page: Page, index = 0) =>
  page.locator('a.related-link').nth(index)
const articleLink = (page: Page, name: string) =>
  page.locator('[data-viewer-article]').getByRole('link', { name, exact: true })
/**
 * Presses a button of the check as a reader would: after the moment in
 * which /share.js takes a press for the rest of the one that opened it.
 */
async function choose(target: Locator) {
  await target.page().waitForTimeout(600)
  await target.click()
}
const focusedText = (page: Page) =>
  page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')

test(
  'F27-AC53, F27-AC52: Given the viewer with scripts, When a related link is pressed, Then the viewer stays and the check shows the whole sanitized address with Open and Cancel',
  async () => {
    const { page, away, violations } = await open()
    await relatedLink(page).click()
    const dialog = page.getByRole('dialog', { name: 'このリンクを開きますか' })
    await expect.poll(() => dialog.isVisible(), SETTLE).toBe(true)
    expect(await dialog.locator('[data-link-check-url]').textContent()).toBe(
      SANITIZED,
    )
    expect(
      await dialog.getByRole('link', { name: '開く', exact: true }).isVisible(),
    ).toBe(true)
    expect(
      await dialog
        .getByRole('button', { name: 'キャンセル', exact: true })
        .isVisible(),
    ).toBe(true)
    expect(page.url()).toBe(`${TEST_ORIGIN}/@owner/talk`)
    expect(away).toEqual([])
    expect(await violations()).toEqual([])
    await page.context().close()
  },
  TIMEOUT,
)

test.each(['Cancel', 'Escape'])(
  'F27-AC54: Given the check is open, When it is closed with %s, Then it goes and the viewer stays where it was',
  async (how) => {
    const { page, away } = await open()
    await relatedLink(page).click()
    const dialog = page.locator(DIALOG)
    await expect.poll(() => dialog.count(), SETTLE).toBe(1)
    if (how === 'Escape') await page.keyboard.press('Escape')
    else await choose(dialog.getByRole('button', { name: 'キャンセル' }))
    await expect.poll(() => dialog.count(), SETTLE).toBe(0)
    expect(page.url()).toBe(`${TEST_ORIGIN}/@owner/talk`)
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('')
    expect(away).toEqual([])
    await page.context().close()
  },
  TIMEOUT,
)

test(
  'F27-AC55, F27-AC56: Given the check, When Open is pressed, Then the same tab goes to the sanitized address alone, as a press without scripts does, with the same referrer',
  async () => {
    const { page, away } = await open()
    await relatedLink(page).click()
    await choose(page.locator(DIALOG).getByRole('link', { name: '開く' }))
    await page.waitForURL(SANITIZED, SETTLE)
    expect(page.context().pages()).toHaveLength(1)
    expect(away.map((one) => one.url)).toEqual([SANITIZED.split('#')[0]])
    expect(await page.evaluate(() => window.opener)).toBe(null)

    const without = await open({ javaScriptEnabled: false })
    expect(
      await without.page.locator('template[data-link-check-prompt]').count(),
    ).toBe(1)
    // Brought into view first: without scripts the page is still laid out
    // when the press would land.
    await relatedLink(without.page).scrollIntoViewIfNeeded()
    await relatedLink(without.page).click()
    await without.page.waitForURL(SANITIZED, SETTLE)
    expect(without.page.context().pages()).toHaveLength(1)
    expect(without.away).toEqual(away)
    await page.context().close()
    await without.page.context().close()
  },
  TIMEOUT,
)

test(
  'F27-AC57: Given a link of a long address on a 375 px screen, When it is checked, Then the check fits the screen and the address wraps, shown whole',
  async () => {
    const { page } = await open({ viewport: { width: 375, height: 700 } })
    await relatedLink(page, 1).click()
    const dialog = page.locator(DIALOG)
    await expect.poll(() => dialog.count(), SETTLE).toBe(1)
    const shown = dialog.locator('[data-link-check-url]')
    expect(await shown.textContent()).toBe(
      await relatedLink(page, 1).getAttribute('href'),
    )
    const panel = await dialog.locator('.link-check-panel').boundingBox()
    expect(panel!.x).toBeGreaterThanOrEqual(0)
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(375)
    const box = await shown.evaluate((element) => ({
      scroll: element.scrollWidth,
      client: element.clientWidth,
      lines: Math.round(
        element.getBoundingClientRect().height /
          Number.parseFloat(getComputedStyle(element).lineHeight),
      ),
    }))
    expect(box.scroll).toBeLessThanOrEqual(box.client)
    expect(box.lines).toBeGreaterThan(2)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(375)
    await page.context().close()
  },
  TIMEOUT,
)

test(
  'F27-AC58: Given a related link reached by keyboard, When it is opened with Enter, Then the focus is inside, Tab and Enter choose Open and Cancel, and closing returns the focus to the link',
  async () => {
    const { page, away } = await open()
    await relatedLink(page).focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => page.locator(DIALOG).count(), SETTLE).toBe(1)
    // Cancel first: a second Enter, or a key held down, does not confirm.
    expect(await focusedText(page)).toBe('キャンセル')
    await page.keyboard.press('Tab')
    expect(await focusedText(page)).toBe('開く')
    await page.keyboard.press('Tab')
    expect(await focusedText(page)).toBe('キャンセル')
    await page.keyboard.press('Shift+Tab')
    expect(await focusedText(page)).toBe('開く')
    await page.keyboard.press('Shift+Tab')
    expect(await focusedText(page)).toBe('キャンセル')
    await page.keyboard.press('Enter')
    await expect.poll(() => page.locator(DIALOG).count(), SETTLE).toBe(0)
    expect(
      await page.evaluate(() =>
        document.activeElement?.classList.contains('related-link'),
      ),
    ).toBe(true)
    expect(away).toEqual([])
    await page.keyboard.press('Enter')
    await expect.poll(() => page.locator(DIALOG).count(), SETTLE).toBe(1)
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await page.waitForURL(SANITIZED, SETTLE)
    expect(away.map((one) => one.url)).toEqual([SANITIZED.split('#')[0]])
    await page.context().close()
  },
  TIMEOUT,
)

test.each([
  ['1280', { width: 1280, height: 800 }],
  ['375', { width: 375, height: 700 }],
])(
  'F27-AC53: Given a %s px screen, When a related link is pressed twice quickly, Then the check stays open and nothing is followed',
  async (_name, viewport) => {
    const { page, away } = await open({ viewport, hasTouch: true })
    await relatedLink(page).scrollIntoViewIfNeeded()
    await relatedLink(page).dblclick()
    await page.waitForTimeout(600)
    expect(await page.locator(DIALOG).count()).toBe(1)
    expect(page.url()).toBe(`${TEST_ORIGIN}/@owner/talk`)
    expect(away).toEqual([])
    await page.context().close()
  },
  TIMEOUT,
)

test.each([
  ['外の記事', `${ELSEWHERE}/post?b=1`],
  ['古いサイト', 'http://elsewhere.example/old'],
  ['メール', 'mailto:hello@elsewhere.example'],
])(
  'F26-AC97: Given the article’s link %s out of the service, When it is pressed, Then the same check shows its sanitized address, and Cancel keeps the viewer',
  async (name, href) => {
    const { page, away, violations } = await open()
    await articleLink(page, name).click()
    const dialog = page.locator(DIALOG)
    await expect.poll(() => dialog.count(), SETTLE).toBe(1)
    expect(await dialog.locator('[data-link-check-url]').textContent()).toBe(
      href,
    )
    expect(
      await dialog.getByRole('link', { name: '開く' }).getAttribute('href'),
    ).toBe(href)
    await choose(dialog.getByRole('button', { name: 'キャンセル' }))
    await expect.poll(() => dialog.count(), SETTLE).toBe(0)
    expect(page.url()).toBe(`${TEST_ORIGIN}/@owner/talk`)
    expect(away).toEqual([])
    expect(await violations()).toEqual([])
    await page.context().close()
  },
  TIMEOUT,
)

test(
  'F26-AC97: Given the article’s link out of the service, When Open is pressed, Then the viewer goes to its sanitized address, and without scripts the link goes there at once',
  async () => {
    const { page, away } = await open()
    await articleLink(page, '外の記事').click()
    await choose(page.locator(DIALOG).getByRole('link', { name: '開く' }))
    await page.waitForURL(`${ELSEWHERE}/post?b=1`, SETTLE)
    expect(away.map((one) => one.url)).toEqual([`${ELSEWHERE}/post?b=1`])
    const without = await open({ javaScriptEnabled: false })
    await articleLink(without.page, '外の記事').scrollIntoViewIfNeeded()
    await articleLink(without.page, '外の記事').click()
    await without.page.waitForURL(`${ELSEWHERE}/post?b=1`, SETTLE)
    await page.context().close()
    await without.page.context().close()
  },
  TIMEOUT,
)

test(
  'F26-AC98: Given the article’s link to a share URL, When it is pressed, Then no check opens and the viewer goes to that page',
  async () => {
    const { page, away } = await open()
    await articleLink(page, '共有 URL').click()
    await page.waitForURL(`${TEST_ORIGIN}/@owner/other`, SETTLE)
    expect(await page.locator(DIALOG).count()).toBe(0)
    expect(away).toEqual([])
    await page.context().close()
  },
  TIMEOUT,
)

test(
  'F26-AC98: Given the article’s page image of its own slides, When it is pressed, Then no check opens and the viewer stays',
  async () => {
    const { page, away } = await open({ reducedMotion: 'reduce' })
    const image = page.locator('a.article-embed-link')
    expect(await image.count()).toBe(1)
    expect(await image.getAttribute('data-link-check')).toBe(null)
    await image.click()
    // The page image moves the slides above; nothing else happens.
    await page.waitForTimeout(300)
    expect(await page.locator(DIALOG).count()).toBe(0)
    expect(page.url()).toBe(`${TEST_ORIGIN}/@owner/talk`)
    expect(away).toEqual([])
    await page.context().close()
  },
  TIMEOUT,
)

test(
  'F27-AC53: Given the viewer in English, When a related link is pressed, Then the check is in English',
  async () => {
    const { page } = await open({ locale: 'en-US' }, '/@owner/talk?lang=en')
    await relatedLink(page).click()
    const dialog = page.getByRole('dialog', { name: 'Open this link?' })
    await expect.poll(() => dialog.isVisible(), SETTLE).toBe(true)
    expect(
      await dialog.getByRole('link', { name: 'Open', exact: true }).isVisible(),
    ).toBe(true)
    expect(
      await dialog
        .getByRole('button', { name: 'Cancel', exact: true })
        .isVisible(),
    ).toBe(true)
    await page.context().close()
  },
  TIMEOUT,
)
