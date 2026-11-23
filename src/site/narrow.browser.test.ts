import { afterAll, beforeAll, expect, test } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { HELP_SECTION_IDS } from './help-content'
import { deployments, profiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  seedDeck,
  seedDeployment,
  OWNER_ID,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

// The top page is public/index.html from `pnpm build`; CI builds before testing.
const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

// Words with no place to break, as titles and descriptions sometimes are.
const LONG =
  'Supercalifragilisticexpialidocious_and_a_very_long_unbroken_title_of_slides'
const LONG_JA =
  'とても長い題名のスライドで、折り返さなければ画面の幅をこえてしまうもの'.repeat(
    2,
  )

let browser: Browser
let cookie = ''
beforeAll(async () => {
  await applyMigrations(db)
  // Signing in records the handle "owner".
  cookie = await signIn(env)
  const talk = await seedPublic(db, 'talk', 100, LONG)
  await drizzle(db)
    .update(deployments)
    .set({ description: `${LONG} ${LONG_JA}` })
    .where(eq(deployments.id, talk))
  for (let index = 0; index < 5; index++)
    await seedPublic(db, `more-${index}`, 10 + index, LONG_JA)
  await drizzle(db)
    .insert(profiles)
    .values({
      user_id: OWNER_ID,
      name: 'Owner',
      location: 'Tokyo',
      website: 'https://example.com/me',
    })
    .onConflictDoUpdate({
      target: profiles.user_id,
      set: { website: 'https://example.com/me', location: 'Tokyo' },
    })
  await seedDeck(db, 'draft')
  await seedDeployment(db, 'draft')
  await seedDeployment(db, 'draft', 'failed')
  browser = await chromium.launch()
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

/** A page of the service at the given width, answered by the Worker. */
async function open(path: string, width: number, signedIn: boolean) {
  const page = await browser.newPage({
    viewport: { width, height: 800 },
    locale: 'ja-JP',
  })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    // Covers and the deck itself are not needed to measure the frame.
    if (url.origin !== TEST_ORIGIN) return route.abort()
    // Miniflare's local proxy refuses an Origin outside its own hostnames.
    const { origin: _origin, ...headers } = await route.request().allHeaders()
    if (signedIn) headers.cookie = cookie
    const response = await server.fetch(new Request(url, { headers }), env)
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  await page.goto(`${TEST_ORIGIN}${path}`)
  return page
}

const PAGES: readonly [name: string, path: string, signedIn: boolean][] = [
  ['the top page', '/', false],
  ['the top page, signed in', '/', true],
  ['the viewer', '/@owner/talk', false],
  ['the viewer, signed in', '/@owner/talk', true],
  ['a profile', '/@owner', false],
  ['the list of slides', '/slides', true],
  ['one public slide', '/slides/talk', true],
  ['one draft slide', '/slides/draft', true],
  ['the settings', '/settings', true],
]

test.each(PAGES)(
  'F03-AC11: Given %s with long, unbroken titles on a 375px screen, When it settles, Then nothing runs past the screen',
  async (_name, path, signedIn) => {
    const page = await open(path, 375, signedIn)
    await page.waitForLoadState('networkidle')
    const measured = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      // What sticks out, to name it when the test fails.
      wide: [...document.querySelectorAll('body *')]
        // A closed menu's items keep a box but are not drawn.
        .filter(
          (element) =>
            element.checkVisibility() &&
            element.getBoundingClientRect().right > 375.5,
        )
        .map((element) =>
          `${element.tagName.toLowerCase()}.${element.className}`.slice(0, 60),
        )
        .slice(0, 5),
    }))
    expect(measured).toEqual({ scrollWidth: 375, wide: [] })
    await page.close()
  },
  20000,
)

test.each([1280, 375])(
  'F03-AC38: Given a row of the list of slides on a %ipx screen, When it settles, Then the name and “edit” are each at least 44px tall to press',
  async (width) => {
    const page = await open('/slides', width, true)
    await page.waitForLoadState('networkidle')
    const heights = await page.evaluate(() =>
      ['.deck-row-name a', '.deck-row-edit'].map(
        (selector) =>
          document.querySelector(selector)?.getBoundingClientRect().height ?? 0,
      ),
    )
    expect(heights.every((height) => height >= 44)).toBe(true)
    await page.close()
  },
  20000,
)

test.each([1280, 375])(
  'F03-AC40: Given one slide’s page on a %ipx screen, When it settles, Then the frames stack in one column in the same order and nothing runs past the screen',
  async (width) => {
    const page = await open('/slides/talk', width, true)
    const boxes = await page.evaluate(() =>
      ['title', 'publication', 'share-url', 'replace', 'delete'].map((name) => {
        const box = document
          .querySelector(`[data-deck-frame="${name}"]`)
          ?.getBoundingClientRect()
        return {
          name,
          left: Math.round(box?.left ?? -1),
          top: Math.round(box?.top ?? -1),
          right: Math.round(box?.right ?? -1),
        }
      }),
    )
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    )
    await page.close()
    expect(scrollWidth).toBe(width)
    expect(boxes.every((box) => box.left === boxes[0]?.left)).toBe(true)
    expect(boxes.map((box) => box.top)).toEqual(
      [...boxes.map((box) => box.top)].sort((a, b) => a - b),
    )
    expect(new Set(boxes.map((box) => box.top)).size).toBe(boxes.length)
  },
  20000,
)

test.each([1280, 375])(
  'F03-AC8: Given the viewer on a %ipx screen, When the reader uses the actions, Then there are three, each menu opens alone, says so, stays on the screen, and closes on a press outside or Escape',
  async (width) => {
    const page = await open('/@owner/talk', width, false)
    const actions = page.locator('.viewer-actions')
    const share = actions.locator('details.share-menu')
    const more = actions.locator('details.more-menu')
    // Full screen is hidden where the browser cannot do it; it is counted
    // by its place in the markup.
    expect(
      await actions.locator(':scope > button, :scope > details').count(),
    ).toBe(3)
    expect(
      (await actions.locator(':scope > button').textContent())?.trim(),
    ).toBe('全画面')

    const expanded = (menu: typeof share) =>
      menu.locator('summary').getAttribute('aria-expanded')
    const onScreen = async (menu: typeof share) => {
      const box = await menu.locator('.menu-items').boundingBox()
      return !!box && box.x >= 0 && box.x + box.width <= width
    }

    await share.locator('summary').click()
    await expect.poll(() => expanded(share)).toBe('true')
    expect(
      await share.getByRole('button', { name: 'URL をコピー' }).isVisible(),
    ).toBe(true)
    expect(await onScreen(share)).toBe(true)

    // Opening the other menu closes this one.
    await more.locator('summary').click()
    await expect.poll(() => expanded(more)).toBe('true')
    await expect.poll(() => expanded(share)).toBe('false')
    const report = more.getByRole('link', { name: '通報する' })
    expect(await report.isVisible()).toBe(true)
    expect((await report.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    expect(await onScreen(more)).toBe(true)

    // Escape closes it and hands the focus back to its button.
    await page.keyboard.press('Escape')
    await expect.poll(() => expanded(more)).toBe('false')
    expect(
      await more
        .locator('summary')
        .evaluate((summary) => summary === document.activeElement),
    ).toBe(true)

    // A press outside closes it.
    await share.locator('summary').click()
    await expect.poll(() => expanded(share)).toBe('true')
    await page.locator('.viewer-title h1').click()
    await expect.poll(() => expanded(share)).toBe('false')
    expect(await share.locator('.menu-items').isVisible()).toBe(false)

    // Each thing to press is at least 44px tall.
    for (const target of [share.locator('summary'), more.locator('summary')])
      expect((await target.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    await page.close()
  },
  20000,
)

test.each([
  ['/help', 'ja'],
  ['/help?lang=en', 'en'],
])(
  'F03-AC23: Given the help %s on a 375px screen, When it settles, Then nothing runs past the screen, the contents sit above the text, and each item is 44px tall and leads to its section',
  async (path) => {
    const page = await open(path, 375, false)
    await page.waitForLoadState('networkidle')
    const measured = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      wide: [...document.querySelectorAll('body *')]
        .filter(
          (element) =>
            element.checkVisibility() &&
            element.getBoundingClientRect().right > 375.5,
        )
        .map((element) =>
          `${element.tagName.toLowerCase()}.${element.className}`.slice(0, 60),
        )
        .slice(0, 5),
    }))
    expect(measured).toEqual({ scrollWidth: 375, wide: [] })
    const toc = await page.locator('.help-toc').boundingBox()
    const body = await page.locator('.help-body').boundingBox()
    expect(toc && body && toc.y + toc.height <= body.y + 1).toBe(true)
    const links = page.locator('.help-toc a')
    expect(await links.count()).toBe(HELP_SECTION_IDS.length)
    for (const link of await links.all())
      expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    await links.nth(HELP_SECTION_IDS.indexOf('embed')).click()
    await expect.poll(() => page.url()).toContain('#embed')
    await page.close()
  },
  20000,
)

test('F03-AC23: Given the help on a 1280px screen, When it settles, Then the contents are on the left of the text, side by side, and the text keeps to 40em', async () => {
  const page = await open('/help', 1280, false)
  await page.waitForLoadState('networkidle')
  const toc = await page.locator('.help-toc').boundingBox()
  const body = await page.locator('.help-body').boundingBox()
  expect(toc && body && toc.x + toc.width <= body.x).toBe(true)
  expect(toc?.y).toBeLessThan((body?.y ?? 0) + 100)
  const widest = await page.evaluate(() =>
    Math.max(
      ...[...document.querySelectorAll('.help-body p')].map(
        (paragraph) => paragraph.getBoundingClientRect().width,
      ),
    ),
  )
  expect(widest).toBeLessThanOrEqual(40 * 16 + 1)
  await page.close()
})

/**
 * Runs in the page: the links that stand alone whose touch area is under
 * 44px, each named with the href and how much of a 44px column around its
 * centre hits the link itself (its drawn box or a layer it lays over it).
 */
function findShortLinks(): string[] {
  const alone = (link: Element) =>
    ![...(link.parentElement?.childNodes ?? [])].some(
      (node) => node.nodeType === 3 && (node.textContent ?? '').trim() !== '',
    )
  const reach = (link: Element) => {
    const box = link.getBoundingClientRect()
    let hits = 0
    for (let dy = -22; dy < 22; dy++) {
      const hit = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2 + dy,
      )
      if (hit && link.contains(hit)) hits++
    }
    return hits
  }
  const short: string[] = []
  for (const link of document.querySelectorAll('main a[href]')) {
    if (!link.checkVisibility() || !alone(link)) continue
    link.scrollIntoView({ block: 'center' })
    if (link.getBoundingClientRect().height >= 44) continue
    const hits = reach(link)
    if (hits < 44) short.push(`${link.getAttribute('href')} reach ${hits}`)
  }
  return short
}

const ALONE_LINKS: readonly [path: string, signedIn: boolean][] = [
  ['/@owner', false],
  ['/settings', true],
  ['/slides/talk', true],
  ['/@owner/following', false],
]

test.each([1280, 375])(
  'F03-AC74: Given the links that stand alone on a profile, the settings and a slide, When a %ipx screen settles, Then each has a touch area at least 44px tall',
  async (width) => {
    const short: string[] = []
    for (const [path, signedIn] of ALONE_LINKS) {
      const page = await open(path, width, signedIn)
      await page.waitForLoadState('networkidle')
      const found = await page.evaluate(findShortLinks)
      short.push(...found.map((one) => `${path}: ${one}`))
      await page.close()
    }
    expect(short).toEqual([])
  },
  30000,
)

const FOOTER_PAGES: readonly [name: string, path: string, signedIn: boolean][] =
  [
    ['the notifications, with nothing in them', '/notifications', true],
    ['a page that does not exist', '/no-such-page', false],
    ['the help, which scrolls', '/help', false],
    ['the settings', '/settings', true],
  ]

test.each(
  FOOTER_PAGES.flatMap(([name, path, signedIn]) =>
    [1280, 375].map((width) => [name, width, path, signedIn] as const),
  ),
)(
  'F03-AC76: Given %s on a %ipx screen, When it settles, Then the footer never overlaps the page and, on a short page, ends at the bottom of the screen',
  async (_name, width, path, signedIn) => {
    const page = await open(path, width, signedIn)
    await page.waitForLoadState('networkidle')
    const box = await page.evaluate(() => {
      const main = document.querySelector('main')?.getBoundingClientRect()
      const footer = document
        .querySelector('.site-footer')
        ?.getBoundingClientRect()
      return {
        mainBottom: (main?.bottom ?? 0) + scrollY,
        footerTop: (footer?.top ?? 0) + scrollY,
        footerBottom: (footer?.bottom ?? 0) + scrollY,
        document: document.documentElement.scrollHeight,
        screen: innerHeight,
      }
    })
    expect(box.footerTop).toBeGreaterThanOrEqual(box.mainBottom - 0.5)
    // The footer is the last thing: the page ends where it ends.
    expect(Math.abs(box.footerBottom - box.document)).toBeLessThanOrEqual(1)
    // Short or long, the page is never shorter than the screen.
    expect(box.document).toBeGreaterThanOrEqual(box.screen)
    if (box.mainBottom + (box.footerBottom - box.footerTop) < box.screen)
      expect(Math.abs(box.footerBottom - box.screen)).toBeLessThanOrEqual(1)
    await page.close()
  },
  20000,
)

test.each([1280, 375])(
  'F17-AC34, F17-AC35: Given the report form on a %ipx screen, When it settles, Then each reason is a mark beside plain words at least 44px tall, the keyboard picks one, and the framed slides fill the width',
  async (width) => {
    const page = await open(
      `/reports/new?slide=${encodeURIComponent('/@owner/talk')}`,
      width,
      true,
    )
    await page.waitForLoadState('networkidle')
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('fieldset.choices label.choice')].map(
        (label) => {
          const mark = label.querySelector('input')?.getBoundingClientRect()
          const words = label.querySelector('span')
          const text = words?.getBoundingClientRect()
          return {
            height: label.getBoundingClientRect().height,
            weight: getComputedStyle(label).fontWeight,
            beside: Boolean(
              mark &&
              text &&
              mark.right <= text.left + 0.5 &&
              mark.top < text.bottom &&
              mark.bottom > text.top,
            ),
          }
        },
      ),
    )
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.beside).toBe(true)
      expect(row.weight).toBe('400')
      expect(row.height).toBeGreaterThanOrEqual(44)
    }
    // Tab reaches the group; the arrow keys choose within it.
    await page.locator('input[name="reason"]').first().focus()
    await page.keyboard.press('ArrowDown')
    expect(
      await page.evaluate(
        () =>
          document.querySelector<HTMLInputElement>(
            'input[name="reason"]:checked',
          )?.value,
      ),
    ).toBe('rights')
    const layout = await page.evaluate(() => ({
      frame: document
        .querySelector('.report-slide iframe')
        ?.getBoundingClientRect().width,
      column: document
        .querySelector('form[action="/reports"]')
        ?.getBoundingClientRect().width,
      scroll: document.documentElement.scrollWidth,
    }))
    expect(layout.frame).toBe(layout.column)
    expect(layout.scroll).toBe(width)
    expect(await page.locator('.report-slide iframe').getAttribute('src')).toBe(
      '/embed/@owner/talk',
    )
    await page.close()
  },
  20000,
)

/** The gap between a label and the field under it, in pixels. */
const gapUnder = (
  page: import('playwright').Page,
  label: string,
  field: string,
) =>
  page.evaluate(
    ([labelSelector, fieldSelector]) => {
      const top = document
        .querySelector(labelSelector!)
        ?.getBoundingClientRect()
      const next = document
        .querySelector(fieldSelector!)
        ?.getBoundingClientRect()
      return Math.round((next?.top ?? 0) - (top?.bottom ?? 0))
    },
    [label, field],
  )

test.each([1280, 375])(
  'F27-AC38: Given the add form of related links on a %ipx screen, When it settles, Then each label is as near its field as in the settings, and nothing runs past the screen',
  async (width) => {
    const settings = await open('/settings', width, true)
    const wanted = await gapUnder(
      settings,
      'label[for="profile-name"]',
      '#profile-name',
    )
    await settings.close()
    const page = await open('/slides/talk', width, true)
    for (const id of ['link-url', 'link-title'])
      expect(await gapUnder(page, `label[for="${id}"]`, `#${id}`)).toBe(wanted)
    expect(wanted).toBeLessThanOrEqual(8)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width)
    await page.close()
  },
  20000,
)

test.each([1280, 375])(
  'F02-AC50: Given the publication frame on a %ipx screen, When it settles, Then the state tag is in the heading’s row and the button sits right under that row',
  async (width) => {
    const page = await open('/slides/draft', width, true)
    const box = await page.evaluate(() => {
      const rect = (selector: string) =>
        document.querySelector(selector)?.getBoundingClientRect()
      const frame = '[data-deck-frame="publication"]'
      const heading = rect(`${frame} h2`)
      const chip = rect(`${frame} .status-chip`)
      const head = rect(`${frame} .panel-head`)
      const button = rect(`${frame} button`)
      return {
        sameRow: Math.abs(
          (heading?.top ?? 0) +
            (heading?.height ?? 0) / 2 -
            ((chip?.top ?? 0) + (chip?.height ?? 0) / 2),
        ),
        chipRight: chip?.left ?? 0,
        headingRight: heading?.right ?? 0,
        gap: (button?.top ?? 0) - (head?.bottom ?? 0),
      }
    })
    expect(box.sameRow).toBeLessThanOrEqual(2)
    expect(box.chipRight).toBeGreaterThanOrEqual(box.headingRight)
    expect(box.gap).toBeGreaterThanOrEqual(0)
    expect(box.gap).toBeLessThanOrEqual(24)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width)
    await page.close()
  },
  20000,
)

test.each([1280, 375])(
  'F22-AC43: Given a slide never published on a %ipx screen, When its page opens, Then the URL is an input after the start of the URL, inside the frame, and nothing runs past the screen',
  async (width) => {
    const page = await open('/slides/draft', width, true)
    const field = await page.evaluate(() => {
      const frame = document
        .querySelector('[data-deck-frame="share-url"]')
        ?.getBoundingClientRect()
      const wrap = document
        .querySelector('.prefixed-field')
        ?.getBoundingClientRect()
      const input = document.querySelector('#url-name')?.getBoundingClientRect()
      return {
        prefix: document.querySelector('.prefixed-field > span')?.textContent,
        inside: (wrap?.right ?? 0) <= (frame?.right ?? 0),
        inputWidth: input?.width ?? 0,
      }
    })
    expect(field.prefix).toBe('slide.example/@owner/')
    expect(field.inside).toBe(true)
    expect(field.inputWidth).toBeGreaterThanOrEqual(80)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width)
    await page.close()
  },
  20000,
)
