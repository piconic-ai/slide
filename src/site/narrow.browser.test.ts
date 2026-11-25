import { openTestBrowser } from '../test-open-browser'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { Browser, Page } from 'playwright'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { keepArticle } from '../articles/store'
import { followCommunity } from '../communities/follow-store'
import { seedCommunity, seedTalkLink } from '../communities/test-communities'
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
  // A community the owner follows, holding five of the owner's slides.
  await seedCommunity(db, {
    id: 61,
    handle: 'kanagawapm',
    name: 'Supercalifragilisticexpialidocious_community_name',
    links: ['https://kanagawapm.connpass.com/'],
    // Run by someone else: the owner's settings and slides stay as they were.
    creator: '999',
  })
  for (const [index, deckId] of [
    'more-0',
    'more-1',
    'more-2',
    'more-3',
    'more-4',
  ].entries())
    await seedTalkLink(db, {
      deckId,
      url: `https://kanagawapm.connpass.com/event/${index + 1}/`,
    })
  await followCommunity(db, { userId: OWNER_ID, communityId: 61, now: 1 })
  await seedDeck(db, 'draft')
  await keepArticle(db, {
    deckId: 'draft',
    body: '# Notes\n\nWhat I said.',
    status: 'draft',
    citations: [],
    now: 1,
  })
  await seedDeployment(db, 'draft')
  await seedDeployment(db, 'draft', 'failed')
  browser = await openTestBrowser()
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

async function settled(path: string, width: number, signedIn: boolean) {
  const page = await open(path, width, signedIn)
  await page
    .locator(signedIn ? '[data-account] .avatar' : '[data-account] .sign-in')
    .waitFor()
  if (path === '/') {
    await page.locator('.recent-body a.card-title').first().waitFor()
    if (signedIn)
      await page.locator('.home-following .home-room-note').waitFor()
    await page.locator('[data-drop-choose]:enabled').waitFor()
  }
  return page
}

async function atBothWidths(
  page: Page,
  measure: (width: number) => Promise<void>,
) {
  try {
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 800 })
      await measure(width)
    }
  } finally {
    await page.close()
  }
}

const PAGES: readonly [name: string, path: string, signedIn: boolean][] = [
  ['the top page', '/', false],
  ['the top page, signed in', '/', true],
  ['the viewer', '/@owner/talk', false],
  ['the viewer, signed in', '/@owner/talk', true],
  ['a profile', '/@owner', false],
  ['the communities of a profile', '/@owner/communities', false],
  ['the slides of followed communities', '/communities/following', true],
  ['the list of slides', '/slides', true],
  ['one public slide', '/slides/talk', true],
  ['one draft slide', '/slides/draft', true],
  ['the settings', '/settings', true],
]

test.each(PAGES)(
  'F03-AC11: Given %s with long, unbroken titles on a 375px screen, When it settles, Then nothing runs past the screen',
  async (_name, path, signedIn) => {
    const page = await settled(path, 375, signedIn)
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

test('F03-AC38: Given a row of the list of slides at 1280px and 375px, When it settles, Then the name and “edit” are each at least 44px tall to press', async () => {
  const page = await settled('/slides', 1280, true)
  await atBothWidths(page, async () => {
    const heights = await page.evaluate(() =>
      ['.deck-row-name a', '.deck-row-edit'].map(
        (selector) =>
          document.querySelector(selector)?.getBoundingClientRect().height ?? 0,
      ),
    )
    expect(heights.every((height) => height >= 44)).toBe(true)
  })
}, 20000)

test('F03-AC40, F22-AC45: Given one slide’s page at 1280px and 375px, When it settles, Then the frames stack in one column, the delete label sits just above its field, and nothing runs past the screen', async () => {
  // A slide never published has every frame, the URL's among them.
  const page = await open('/slides/draft', 1280, true)
  await atBothWidths(page, async (width) => {
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
    const deleteGap = await gapUnder(
      page,
      'label[for="delete-confirm"]',
      '#delete-confirm',
    )
    expect(deleteGap).toBeLessThanOrEqual(8)
    expect(scrollWidth).toBe(width)
    expect(boxes.every((box) => box.left === boxes[0]?.left)).toBe(true)
    expect(boxes.map((box) => box.top)).toEqual(
      [...boxes.map((box) => box.top)].sort((a, b) => a - b),
    )
    expect(new Set(boxes.map((box) => box.top)).size).toBe(boxes.length)
  })
}, 20000)

test.each([1280, 375])(
  'F03-AC34: Given the viewer on a %ipx screen, When the reader uses the three actions, Then each menu opens alone, says so, stays on the screen, and closes on a press outside or Escape',
  async (width) => {
    const page = await open('/@owner/talk', width, false)
    const actions = page.locator('.viewer-actions')
    const share = actions.locator('details.share-menu')
    const more = actions.locator('details.more-menu')
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
    const page = await settled(path, 375, false)
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
    for (const link of await links.all())
      expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    await page.locator('.help-toc a[href="#embed"]').click()
    await expect.poll(() => page.url()).toContain('#embed')
    await page.close()
  },
  20000,
)

test('F03-AC23: Given the help on a 1280px screen, When it settles, Then the contents are on the left of the text, side by side, and the text keeps to 40em', async () => {
  const page = await settled('/help', 1280, false)
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

test.each(ALONE_LINKS)(
  'F03-AC74: Given the standalone links on %s, When they are measured at 1280px and 375px, Then each has a touch area at least 44px tall and the page fits the screen',
  async (path, signedIn) => {
    const page = await settled(path, 1280, signedIn)
    await atBothWidths(page, async (width) => {
      expect(
        await page.evaluate(findShortLinks),
        `${path} at ${width}px`,
      ).toEqual([])
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width)
    })
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

test.each(FOOTER_PAGES)(
  'F03-AC76: Given %s, When it settles at 1280px and 375px, Then the footer never overlaps the page and, on a short page, ends at the bottom of the screen',
  async (_name, path, signedIn) => {
    const page = await settled(path, 1280, signedIn)
    await atBothWidths(page, async () => {
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
    })
  },
  20000,
)

test.each([1280, 375])(
  'F17-AC34, F17-AC35: Given the report form on a %ipx screen, When it settles, Then each reason is a mark beside plain words at least 44px tall, the keyboard picks one, and the framed slides fill the width',
  async (width) => {
    const page = await settled(
      `/reports/new?slide=${encodeURIComponent('/@owner/talk')}`,
      width,
      true,
    )
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
    expect(layout.frame).toBeGreaterThan(0)
    expect(layout.frame).toBe(layout.column)
    expect(layout.scroll).toBe(width)
    await page.close()
  },
  20000,
)

/** The gap between a label and the field under it, in pixels. */
const gapUnder = (page: Page, label: string, field: string) =>
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

/** The box of an element in page coordinates, or null. */
const boxOf = (page: Page, selector: string) =>
  page.evaluate((query) => {
    const box = document.querySelector(query)?.getBoundingClientRect()
    return box
      ? {
          top: box.top + scrollY,
          bottom: box.bottom + scrollY,
          left: box.left,
          right: box.right,
          height: box.height,
          middle: box.top + scrollY + box.height / 2,
        }
      : null
  }, selector)

/**
 * How many rows the visible parts inside a frame stand in: parts whose
 * middles are within half the smallest part's height of each other are one
 * row. A count of rows does not depend on the font the machine has.
 */
const rowsIn = (page: Page, parts: string) =>
  page.evaluate((selector) => {
    const boxes = [...document.querySelectorAll(selector)]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => element.getBoundingClientRect())
      .filter((box) => box.height > 0)
    if (boxes.length === 0) return 0
    const tolerance = Math.min(...boxes.map((box) => box.height)) / 2
    const middles = boxes
      .map((box) => box.top + box.height / 2)
      .sort((a, b) => a - b)
    let rows = 1
    for (let index = 1; index < middles.length; index++)
      if ((middles[index] ?? 0) - (middles[index - 1] ?? 0) > tolerance) rows++
    return rows
  }, parts)

test('F02-AC53: Given the publication frame of a slide never published at 1280px and 375px, When it settles, Then the heading, the tag and the button are one row on a wide screen (their middles within 1px, the button at the right end) and at most two on a narrow one, and the frame is no more than one button height taller than its rows', async () => {
  const page = await open('/slides/draft', 1280, true)
  await atBothWidths(page, async (width) => {
    const frame = '[data-deck-frame="publication"]'
    const heading = await boxOf(page, `${frame} h2`)
    const chip = await boxOf(page, `${frame} .status-chip`)
    const button = await boxOf(page, `${frame} form button`)
    const box = await boxOf(page, frame)
    expect(heading && chip && button && box).toBeTruthy()
    if (width === 1280) {
      expect(
        Math.abs((heading?.middle ?? 0) - (chip?.middle ?? 99)),
      ).toBeLessThanOrEqual(1)
      expect(
        Math.abs((heading?.middle ?? 0) - (button?.middle ?? 99)),
      ).toBeLessThanOrEqual(1)
      // The button is at the right end of the row.
      expect(button?.left).toBeGreaterThan(chip?.right ?? 0)
      expect(
        Math.abs((box?.right ?? 0) - 21 - (button?.right ?? 0)),
      ).toBeLessThanOrEqual(1)
      expect(
        await rowsIn(
          page,
          `${frame} h2, ${frame} .status-chip, ${frame} form button`,
        ),
      ).toBe(1)
    } else {
      expect(
        await rowsIn(
          page,
          `${frame} h2, ${frame} .status-chip, ${frame} form button`,
        ),
      ).toBeLessThanOrEqual(2)
    }
    // Relative to the button, whose height is fixed, not to a pixel count: one
    // more button's height than it has rows, for the frame's own space.
    const rows = await rowsIn(
      page,
      `${frame} h2, ${frame} .status-chip, ${frame} form button`,
    )
    expect(box?.height).toBeLessThan((rows + 1) * (button?.height ?? 0))
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width)
  })
}, 20000)

test.each([1280, 375])(
  'F22-AC46: Given a slide never published on a %ipx screen, When its page opens, Then the URL frame is one small row with a link of 44px or more, a press opens the field after the start of the URL inside the frame, and nothing runs past the screen',
  async (width) => {
    const page = await open('/slides/draft', width, true)
    const frame = page.locator('[data-deck-frame="share-url"]')
    expect(await frame.locator('#url-name').isVisible()).toBe(false)
    const summary = frame.locator('summary')
    expect((await summary.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    // One row: under twice as tall as the link it holds.
    expect(
      (await boxOf(page, '[data-deck-frame="share-url"]'))?.height,
    ).toBeLessThan(2 * ((await summary.boundingBox())?.height ?? 0))
    await summary.click()
    expect(await frame.locator('#url-name').isVisible()).toBe(true)
    const field = await page.evaluate(() => {
      const box = (selector: string) =>
        document.querySelector(selector)?.getBoundingClientRect()
      const wrap = box('.prefixed-field')
      const frame = box('[data-deck-frame="share-url"]')
      return {
        inside: (wrap?.right ?? 0) <= (frame?.right ?? 0),
        inputWidth: box('#url-name')?.width ?? 0,
      }
    })
    expect(field.inside).toBe(true)
    expect(field.inputWidth).toBeGreaterThanOrEqual(80)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width)
    await page.close()
  },
  20000,
)

test.each([1280, 375])(
  'F02-AC54: Given the slide’s page and the article’s page on a %ipx screen, When they settle, Then the button "ビューアーで見る" has its middle within 1px of its neighbour’s, and the first row is 16px under the header’s line on both',
  async (width) => {
    const deck = await open('/slides/draft', width, true)
    const header = (await boxOf(deck, '.site-header'))?.bottom ?? 0
    const back = await boxOf(deck, '.deck-page .back-link')
    const button = await boxOf(
      deck,
      '[data-deck-frame="title"] a.button-secondary',
    )
    const title = await boxOf(deck, '[data-deck-frame="title"] h1')
    expect(button).toBeTruthy()
    expect(Math.abs((back?.top ?? 0) - header - 16)).toBeLessThanOrEqual(1)
    if (width === 1280)
      expect(
        Math.abs((button?.middle ?? 99) - (title?.middle ?? 0)),
      ).toBeLessThanOrEqual(1)
    expect(button?.height ?? 0).toBeGreaterThanOrEqual(44)
    await deck.close()

    const article = await open('/slides/draft/article', width, true)
    const articleHeader = (await boxOf(article, '.site-header'))?.bottom ?? 0
    const articleBack = await boxOf(article, '.article-top .back-link')
    const articleButton = await boxOf(article, '.article-top button')
    expect(articleButton).toBeTruthy()
    // The button is not stuck to the line: it sits as far below it as the
    // slide's page puts its first row.
    expect(
      Math.abs((articleButton?.top ?? 0) - articleHeader - 16),
    ).toBeLessThanOrEqual(1)
    if (width === 1280)
      expect(
        Math.abs((articleButton?.middle ?? 99) - (articleBack?.middle ?? 0)),
      ).toBeLessThanOrEqual(1)
    expect(
      await article.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width)
    await article.close()
  },
  20000,
)

test.each([1280, 375])(
  'F26-AC93: Given the article frame of a slide on a %ipx screen, When there is none and When there is a draft, Then with none it is one row (two on a narrow screen), and with a draft at most two rows on a wide screen and four on a narrow one, and nothing runs past the screen',
  async (width) => {
    const parts = (frame: string) =>
      `${frame} h2, ${frame} .status-chip, ${frame} .article-frame-info, ${frame} .article-frame-actions a, ${frame} .article-frame-actions button`
    const frame = '[data-deck-frame="article"]'
    const empty = await open('/slides/more-0', width, true)
    expect(await rowsIn(empty, parts(frame))).toBeLessThanOrEqual(
      width === 1280 ? 1 : 2,
    )
    await empty.close()

    const withDraft = await open('/slides/draft', width, true)
    expect(await rowsIn(withDraft, parts(frame))).toBeLessThanOrEqual(
      width === 1280 ? 2 : 4,
    )
    const heading = await boxOf(withDraft, `${frame} h2`)
    const chip = await boxOf(withDraft, `${frame} .status-chip`)
    expect(
      Math.abs((heading?.middle ?? 0) - (chip?.middle ?? 99)),
    ).toBeLessThanOrEqual(1)
    expect(
      await withDraft.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width)
    await withDraft.close()
  },
  20000,
)

test('F31-AC14: Given the communities tab and the top page on a 375px screen, When they settle, Then the recent slides of a community stand two by two in two rows, and neither page runs past the screen', async () => {
  const tab = await settled('/@owner/communities', 375, false)
  const cards = await tab.evaluate(() =>
    [...document.querySelectorAll('.followed-community .deck-card')].map(
      (card) => {
        const box = card.getBoundingClientRect()
        return { left: Math.round(box.left), top: Math.round(box.top) }
      },
    ),
  )
  expect(cards).toHaveLength(4)
  expect(new Set(cards.map((card) => card.left)).size).toBe(2)
  expect(new Set(cards.map((card) => card.top)).size).toBe(2)
  expect(await tab.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  )
  await tab.close()

  const top = await settled('/', 375, true)
  await top.locator('.home-communities .deck-card').first().waitFor()
  expect(await top.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  )
  await top.close()
}, 20000)
