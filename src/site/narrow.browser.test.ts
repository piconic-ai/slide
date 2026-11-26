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
import { communities, deployments, profiles } from '../db/schema'
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
  // Its description has no place to break; a second community has none.
  await drizzle(db)
    .update(communities)
    .set({ description: `${LONG} ${LONG_JA}` })
    .where(eq(communities.id, 61))
  await seedCommunity(db, {
    id: 62,
    handle: 'hono',
    name: 'Hono',
    links: ['https://hono.connpass.com/'],
    creator: '999',
  })
  // A third community, so three columns can be told from two.
  await seedCommunity(db, {
    id: 63,
    handle: 'denoland',
    name: 'Deno',
    links: ['https://deno.connpass.com/'],
    creator: '999',
  })
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
  // A slide whose first upload stopped half way: nothing was received.
  await seedDeck(db, 'empty')
  await seedDeployment(db, 'empty', 'failed')
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
    await page.locator('.timeline-card a.timeline-card-title').first().waitFor()
    await page.locator('[data-drop-choose]:enabled').waitFor()
    await page.locator('.carousel-card').first().waitFor()
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
  ['the new communities', '/communities', false],
  ['the list of slides', '/my/slides', true],
  ['one public slide', '/my/slides/talk', true],
  ['one draft slide', '/my/slides/draft', true],
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
        // A closed menu's items keep a box but are not drawn, and a row
        // that slides sideways by itself (a profile's tabs, the top page's
        // tabs, a carousel's track) holds what it hides inside its own box.
        .filter(
          (element) =>
            element.checkVisibility() &&
            element.getBoundingClientRect().right > 375.5 &&
            !element.parentElement?.closest(
              '.profile-tabs, .home-tab-row, .carousel-track',
            ),
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
  const page = await settled('/my/slides', 1280, true)
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

test.each([
  ['signed-in', '/settings', true],
  ['signed-out', '/communities', false],
] as const)(
  'F03-AC180: Given the %s header on a 320px screen, When it settles, Then the wordmark shrinks to the width left, the account area keeps its size on one line, and nothing runs past the screen',
  async (_state, path, signedIn) => {
    const page = await settled(path, 320, signedIn)
    try {
      const measured = await page.evaluate(() => {
        const box = (selector: string) =>
          document.querySelector(selector)?.getBoundingClientRect()
        return {
          scrollWidth: document.documentElement.scrollWidth,
          header: Math.round(box('.site-header')?.height ?? 0),
          account: box('[data-account]'),
          brandRight: Math.ceil(box('.site-header .brand')?.right ?? 0),
          // The way in, when signed out: its text must not wrap.
          signInHeight: Math.round(box('[data-account] .sign-in')?.height ?? 0),
        }
      })
      expect(measured.scrollWidth).toBe(320)
      expect(Math.ceil(measured.account?.right ?? 0)).toBeLessThanOrEqual(320)
      // The wordmark ends before the account area starts.
      expect(measured.brandRight).toBeLessThanOrEqual(
        Math.floor(measured.account?.left ?? 0),
      )
      // One line of the way in, so the header keeps its height.
      expect(measured.header).toBeLessThanOrEqual(69)
      if (!signedIn) expect(measured.signInHeight).toBeLessThanOrEqual(44)
    } finally {
      await page.close()
    }
  },
  20000,
)

test('F03-AC40, F22-AC45: Given one slide’s page at 1280px and 375px, When it settles, Then the frames stack in one column, the delete label sits just above its field, and nothing runs past the screen', async () => {
  // A slide never published has every frame, the URL's among them.
  const page = await open('/my/slides/draft', 1280, true)
  await atBothWidths(page, async (width) => {
    const boxes = await page.evaluate(() =>
      ['title', 'slide', 'share-url', 'delete'].map((name) => {
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

test('F27-AC88: Given a slide with an event link on a 375px screen, When its page settles, Then the kind and “remove” share the first line of the row, the title and site take the whole row under them, and nothing runs past the screen', async () => {
  const page = await open('/my/slides/more-0', 375, true)
  const row = page.locator('.link-rows .link-row').first()
  const box = async (selector: string) =>
    (await row.locator(selector).first().boundingBox())!
  const [whole, kind, body, remove] = await Promise.all([
    row.boundingBox(),
    box('.link-row-kind'),
    box('.link-row-body'),
    box(':scope > form > button'),
  ])
  expect(Math.abs(kind.y - remove.y)).toBeLessThanOrEqual(8)
  expect(body.y).toBeGreaterThanOrEqual(kind.y + kind.height)
  expect(body.width).toBeGreaterThanOrEqual(whole!.width - 1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  )
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
  ['/my/slides/talk', true],
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
    const page = await open('/my/slides/talk', width, true)
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

test('F02-AC58, F02-AC59 and F02-AC66: Given the slide frame of a slide never published at 1280px and 375px, When it settles, Then the first row has the tag beside the name and ends with its one button at the right (under the rest on a narrow screen), and on a wide screen the drop zone is 96px high or lower', async () => {
  const page = await open('/my/slides/draft', 1280, true)
  await atBothWidths(page, async (width) => {
    const row = '[data-deck-frame="slide"] .version-row'
    const name = await boxOf(page, `${row} .version-row-kind`)
    const chip = await boxOf(page, `${row} .status-chip`)
    const button = await boxOf(page, `${row} form button`)
    const box = await boxOf(page, row)
    expect(name && chip && button && box).toBeTruthy()
    // F02-AC58: the tag sits beside the name; on a narrow screen it may
    // wrap under it, inside the same block, never past the row.
    if (width === 1280) {
      expect(chip?.left).toBeGreaterThan(name?.right ?? 0)
      expect(
        Math.abs((chip?.middle ?? 0) - (name?.middle ?? 99)),
      ).toBeLessThanOrEqual(2)
    } else {
      expect(chip?.right).toBeLessThanOrEqual(box?.right ?? 0)
      // The button wraps under the name, the tag and the date.
      const text = await boxOf(page, `${row} .version-row-text`)
      expect(button?.top).toBeGreaterThanOrEqual(text?.bottom ?? 0)
    }
    expect(
      Math.abs((box?.right ?? 0) - (button?.right ?? 99)),
    ).toBeLessThanOrEqual(1)
    if (width === 1280) {
      expect(button?.left).toBeGreaterThan(chip?.right ?? 0)
      const zone = await boxOf(page, '[data-deck-frame="slide"] .drop-zone')
      expect(zone?.height).toBeLessThanOrEqual(96)
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width)
  })
}, 20000)

test.each([1280, 375])(
  'F02-AC67: Given a slide whose first upload never arrived, on a %ipx screen, When its page opens, Then the slide frame has no rows and a drop zone 160px high or more, and nothing runs past the screen',
  async (width) => {
    const page = await open('/my/slides/empty', width, true)
    expect(
      await page.locator('[data-deck-frame="slide"] .version-row').count(),
    ).toBe(0)
    const zone = await boxOf(page, '[data-deck-frame="slide"] .drop-zone')
    expect(zone?.height).toBeGreaterThanOrEqual(160)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width)
    await page.close()
  },
  20000,
)

test.each([1280, 375])(
  'F22-AC46: Given a slide never published on a %ipx screen, When its page opens, Then the URL frame is one small row with a link of 44px or more, a press opens the field after the start of the URL inside the frame, and nothing runs past the screen',
  async (width) => {
    const page = await open('/my/slides/draft', width, true)
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
  'F02-AC65 and F26-AC106: Given the slide’s page and the article’s page on a %ipx screen, When they settle, Then the first row is 16px under the header’s line on both, and the article’s viewer button has its middle within 1px of the way back',
  async (width) => {
    const deck = await open('/my/slides/draft', width, true)
    const header = (await boxOf(deck, '.site-header'))?.bottom ?? 0
    const back = await boxOf(deck, '.deck-page .back-link')
    expect(Math.abs((back?.top ?? 0) - header - 16)).toBeLessThanOrEqual(1)
    await deck.close()

    const article = await open('/my/slides/draft/article', width, true)
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
    const empty = await open('/my/slides/more-0', width, true)
    expect(await rowsIn(empty, parts(frame))).toBeLessThanOrEqual(
      width === 1280 ? 1 : 2,
    )
    await empty.close()

    const withDraft = await open('/my/slides/draft', width, true)
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

test('F21-AC66: Given a profile opened on its last tab on a 375px screen, When it settles and the tabs are gone through with the keyboard, Then the six tabs stand on one row that alone slides, the open tab and each one reached are in its view, and the page does not run past the screen', async () => {
  const page = await settled('/@owner/cited', 375, false)
  const tabs = page.locator('.profile-tabs a')
  expect(await tabs.count()).toBe(6)
  const inView = (index: number) =>
    tabs.nth(index).evaluate((tab) => {
      const row = tab.parentElement?.getBoundingClientRect()
      const box = tab.getBoundingClientRect()
      return (
        row !== undefined &&
        box.left >= row.left - 0.5 &&
        box.right <= row.right + 0.5
      )
    })
  const measured = await page.evaluate(() => {
    const row = document.querySelector('.profile-tabs')
    const tops = [...document.querySelectorAll('.profile-tabs a')].map((tab) =>
      Math.round(tab.getBoundingClientRect().top),
    )
    return {
      rows: new Set(tops).size,
      slides: row !== null && row.scrollWidth > row.clientWidth,
      moved: row !== null && row.scrollLeft > 0,
      page: document.documentElement.scrollWidth,
      pageLeft: window.scrollX,
    }
  })
  expect(measured).toEqual({
    rows: 1,
    slides: true,
    moved: true,
    page: 375,
    pageLeft: 0,
  })
  expect(await tabs.nth(5).getAttribute('aria-current')).toBe('page')
  expect(await inView(5)).toBe(true)

  await tabs.nth(0).focus()
  expect(await inView(0)).toBe(true)
  for (let index = 1; index < 6; index++) {
    await page.keyboard.press('Tab')
    expect(
      await tabs.nth(index).evaluate((tab) => tab === document.activeElement),
    ).toBe(true)
    expect(await inView(index)).toBe(true)
  }
  expect(await page.evaluate(() => window.scrollX)).toBe(0)
  await page.close()
}, 20000)

test('F31-AC14: Given the communities tab on a 375px screen, When it settles, Then the recent slides of a community stand two by two in two rows, and the page does not run past the screen', async () => {
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
}, 20000)

test.each([['the new communities', '/communities']])(
  'F03-AC171, F30-AC53: Given the cards of %s at 1280px and 375px, When it settles, Then they stand three across or one across, every card as tall as the others, and nothing runs past the screen',
  async (_name, path) => {
    const page = await settled(path, 1280, false)
    await atBothWidths(page, async (width) => {
      const boxes = await page.evaluate(() =>
        [...document.querySelectorAll('.community-card:not(.home-spare)')].map(
          (card) => {
            const box = card.getBoundingClientRect()
            return {
              left: Math.round(box.left),
              height: Math.round(box.height),
            }
          },
        ),
      )
      expect(boxes, `${width}`).toHaveLength(3)
      const lefts = new Set(boxes.map((box) => box.left))
      expect(lefts.size, `${width}`).toBe(width === 1280 ? 3 : 1)
      expect(new Set(boxes.map((box) => box.height)).size, `${width}`).toBe(1)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width)
    })
  },
  20000,
)
