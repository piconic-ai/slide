import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import {
  chromium,
  firefox,
  webkit,
  type BrowserContext,
  type Locator,
  type Page,
} from 'playwright'
import { decks } from '../db/schema'
import { seedDeck, seedDeployment } from '../publication/test-support'
import { applyOperatorCommand } from '../publication/takedown-store'
import { openTestBrowser } from '../test-open-browser'
import {
  CONTENT_ORIGIN_HEADER,
  EVICT_CACHE,
  OFFLINE_MAX_AGE_MS,
  OFFLINE_MAX_VERSIONS,
  STORED_AT_HEADER,
  VIEWER_CACHE,
} from './limits'
import { createWorld, FILES } from './test-offline-world'

/**
 * The viewer's side of offline reading, in a real browser against the real
 * Worker over real HTTP: the viewer keeps what it needs once the version's
 * frame has kept the version, shows a shell with the band when there is no
 * connection, and forgets what the service withdraws. Run with
 * BROWSER=chromium, firefox or webkit.
 */
const engineName = process.env.BROWSER ?? 'chromium'
const engine = { chromium, firefox, webkit }[engineName]
if (!engine) throw new Error(`Unknown BROWSER: ${engineName}`)
vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 })

const world = await createWorld()
const { states, orm } = world
let first = ''
beforeAll(async () => {
  first = await world.publish('talk', 'First')
  await world.publish('other', 'Other')
})
afterAll(() => world.close())
beforeEach(async () => {
  states.clear()
  world.setMaintenance(undefined)
  world.setAuthor(false)
  await orm
    .update(decks)
    .set({ public_deployment_id: first, hidden_at: null })
    .where(eq(decks.id, 'talk'))
})

const withContext = async (use: (context: BrowserContext) => Promise<void>) => {
  // Playwright's WebKit drops what a page wrote to Cache Storage when it
  // navigates, unless the context is kept on disk; Safari does not. Only the
  // viewer's own writes from the page are affected, so this one keeps a profile.
  if (engineName === 'webkit') {
    const profile = await mkdtemp(join(tmpdir(), 'slide-webkit-'))
    const context = await webkit.launchPersistentContext(profile, {
      locale: 'ja-JP',
    })
    try {
      await use(context)
    } finally {
      await context.close()
      await rm(profile, { recursive: true, force: true })
    }
    return
  }
  const browser = await openTestBrowser(engine)
  try {
    await use(await browser.newContext({ locale: 'ja-JP' }))
  } finally {
    await browser.close()
  }
}

const KEY = (slug: string) => `http://localhost:${world.port}/@owner/${slug}`

/** The records of the viewer's cache, by address. */
const recordsOf = (page: Page) =>
  page.evaluate(async (name) => {
    const cache = await caches.open(name)
    return Promise.all(
      (await cache.keys()).map(async (request) => {
        const entry = await cache.match(request)
        return {
          key: request.url,
          storedAt: Number(entry?.headers.get('X-Slide-Stored-At')),
          origin: entry?.headers.get('X-Slide-Content-Origin') ?? '',
        }
      }),
    )
  }, VIEWER_CACHE)

const evictionsOf = (page: Page) =>
  page.evaluate(
    async (name) => (await (await caches.open(name)).keys()).length,
    EVICT_CACHE,
  )

/** Opens the viewer online and waits until its version is kept and its worker is in charge. */
async function openKept(context: BrowserContext, slug = 'talk', query = '') {
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(world.viewer(slug, query))
  await expect
    .poll(async () => (await recordsOf(page)).map((r) => r.key), {
      timeout: 30_000,
    })
    .toContain(KEY(slug))
  await expect
    .poll(
      () =>
        page.evaluate(async () =>
          (await navigator.serviceWorker.getRegistrations()).some(
            (registration) => registration.active,
          ),
        ),
      { timeout: 30_000 },
    )
    .toBe(true)
  return Object.assign(page, { errors })
}

const offline = (...ids: string[]) => {
  states.set('management', 'down')
  for (const id of ids) states.set(id, 'down')
}

/** Waits until the element's text holds `expected`; a missing element has no text yet. */
const hasText = (locator: Locator, expected: string) =>
  expect
    .poll(
      async () =>
        (await locator.textContent({ timeout: 2000 }).catch(() => '')) ?? '',
      { timeout: 25_000 },
    )
    .toContain(expected)

const shellFrame = (page: Page) =>
  page.frameLocator('iframe[data-offline-frame]')

const band = (page: Page) => page.locator('[data-stored-band]')

test('F37-AC1, AC2, AC14, AC15, AC16: Given a viewer opened once, When it is opened with no connection at all, Then the slides show and one band, announced politely, says it is stored in Japanese', async () => {
  await withContext(async (context) => {
    const page = await openKept(context)
    // Online: the viewer is live, and the band's place is empty.
    expect(await band(page).evaluate((slot) => slot.childElementCount)).toBe(0)
    expect(await page.locator('.viewer-notice').count()).toBe(0)
    offline(first)
    await page.goto(world.viewer('talk'))
    await hasText(shellFrame(page).locator('#title'), 'First')
    expect(await band(page).getAttribute('role')).toBe('status')
    expect(await band(page).getAttribute('aria-live')).toBe('polite')
    await hasText(band(page), '接続できないため、保存した版を表示しています。')
    expect(await page.locator('.viewer-notice').count()).toBe(1)
    const button = band(page).getByRole('button', { name: 'もう一度読み込む' })
    expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    // The band sits above the slides.
    const bandTop = (await band(page).boundingBox())?.y ?? 0
    const frameTop = (await page.locator('iframe').boundingBox())?.y ?? 0
    expect(bandTop).toBeLessThan(frameTop)
  })
})

test('F37-AC16: Given a viewer read in English, When it is opened with no connection, Then the band is in English', async () => {
  await withContext(async (context) => {
    const page = await openKept(context, 'talk', '?lang=en')
    offline(first)
    await page.goto(world.viewer('talk'))
    await hasText(band(page), 'You are offline, so a stored version is shown.')
    expect(
      await band(page).getByRole('button', { name: 'Load again' }).isVisible(),
    ).toBe(true)
  })
})

test.each([
  ['F37-AC3', 429],
  ['F37-AC4', 503],
])(
  '%s: Given a viewer opened once, When the service answers %i for everything, Then the stored version shows with the band',
  async (_, status) => {
    await withContext(async (context) => {
      const page = await openKept(context)
      states.set('management', status)
      states.set(first, status)
      await page.goto(world.viewer('talk'))
      await hasText(shellFrame(page).locator('#title'), 'First')
      await hasText(band(page), '保存した版')
    })
  },
)

test('F37-AC13: Given the stored version on screen, When "load again" is pressed, Then it stays while there is no connection, and goes when the service is back, with the live viewer', async () => {
  await withContext(async (context) => {
    const page = await openKept(context)
    offline(first)
    await page.goto(world.viewer('talk'))
    await hasText(band(page), '保存した版')
    await band(page).getByRole('button').click()
    await hasText(shellFrame(page).locator('#title'), 'First')
    await hasText(band(page), '保存した版')
    states.clear()
    await band(page).getByRole('button').click()
    await expect
      .poll(() => page.locator('iframe#deck').count(), { timeout: 20_000 })
      .toBe(1)
    expect(await band(page).evaluate((slot) => slot.childElementCount)).toBe(0)
    expect(await page.locator('.viewer-notice').count()).toBe(0)
  })
})

test('F37-AC5: Given a viewer opened once, When the service is back and a new version is public, Then the new version opens with no band', async () => {
  await withContext(async (context) => {
    const page = await openKept(context)
    const next = await seedDeployment(world.db, 'talk')
    await world.putFiles(next, FILES('Newer'))
    await orm
      .update(decks)
      .set({ public_deployment_id: next })
      .where(eq(decks.id, 'talk'))
    await page.goto(world.viewer('talk'))
    await hasText(page.frameLocator('iframe#deck').locator('#title'), 'Newer')
    expect(await band(page).evaluate((slot) => slot.childElementCount)).toBe(0)
    // The deck now keeps the new version, and the old one is being cleared.
    await expect
      .poll(
        async () =>
          (await recordsOf(page)).find((r) => r.key === KEY('talk'))?.origin,
        {
          timeout: 30_000,
        },
      )
      .toBe(world.origin(next))
    await expect.poll(() => evictionsOf(page), { timeout: 30_000 }).toBe(0)
    offline(first, next)
    await page.goto(world.viewer('talk'))
    await hasText(shellFrame(page).locator('#title'), 'Newer')
  })
})

/**
 * The author's own view of a version, in the frame it is launched into. The
 * frame's session is a partitioned cookie, which Playwright's WebKit does not
 * keep over plain http; there the viewer is checked up to the launch.
 */
async function showsToAuthor(
  page: Page,
  expected: Readonly<{ notice: string; origin: string; heading: string }>,
) {
  await hasText(page.locator('main'), expected.notice)
  expect(
    await page.locator('form[data-launch]').getAttribute('action'),
  ).toContain(`${expected.origin}/_preview/launch`)
  if (engineName !== 'webkit')
    await hasText(
      page.frameLocator('iframe#deck').locator('#title'),
      expected.heading,
    )
}

const workerInCharge = (page: Page) =>
  page.evaluate(() => navigator.serviceWorker.controller !== null)

test("F02-AC29, AC41, AC45: Given the author with the viewer's worker in charge, When they open a version that is not public yet, Then that version shows under its notice", async () => {
  await withContext(async (context) => {
    world.setAuthor(true)
    const page = await openKept(context)
    const next = await seedDeployment(world.db, 'talk')
    await world.putFiles(next, FILES('Newer draft'))
    await page.goto(world.viewer('talk', `?v=${next}`))
    expect(await workerInCharge(page)).toBe(true)
    await showsToAuthor(page, {
      notice: 'まだ公開していない新しい版です',
      origin: world.origin(next),
      heading: 'Newer draft',
    })
  })
})

test("F02-AC18: Given the author with the viewer's worker in charge, When they open their deck that was never public, Then its slides show under its notice", async () => {
  await withContext(async (context) => {
    world.setAuthor(true)
    const page = await openKept(context)
    await seedDeck(world.db, 'unpublished')
    const only = await seedDeployment(world.db, 'unpublished')
    await world.putFiles(only, FILES('Unpublished'))
    await page.goto(world.viewer('unpublished'))
    expect(await workerInCharge(page)).toBe(true)
    await showsToAuthor(page, {
      notice: 'まだ公開していません',
      origin: world.origin(only),
      heading: 'Unpublished',
    })
  })
})

test("F02-AC36: Given the author with the viewer's worker in charge, When they open their deck whose publication is paused, Then its slides show under its notice", async () => {
  await withContext(async (context) => {
    world.setAuthor(true)
    const page = await openKept(context)
    const paused = await world.publish('paused', 'Paused')
    await orm
      .update(decks)
      .set({
        paused_at: 2,
        public_deployment_id: null,
        resume_deployment_id: paused,
      })
      .where(eq(decks.id, 'paused'))
    await page.goto(world.viewer('paused'))
    expect(await workerInCharge(page)).toBe(true)
    await showsToAuthor(page, {
      notice: '公開を止めています',
      origin: world.origin(paused),
      heading: 'Paused',
    })
  })
})

test("F02-AC30: Given a reader with the viewer's worker in charge, When they open the address of a version that is not public, Then the public version shows", async () => {
  await withContext(async (context) => {
    const page = await openKept(context)
    const next = await seedDeployment(world.db, 'talk')
    await world.putFiles(next, FILES('Draft'))
    await page.goto(world.viewer('talk', `?v=${next}`))
    await hasText(page.frameLocator('iframe#deck').locator('#title'), 'First')
  })
})

test('F37-AC21: Given a viewer opened once, When the deck is replaced by a version that cannot be stored and is opened online, Then the old stored version is forgotten, and no stored version shows with no connection', async () => {
  await withContext(async (context) => {
    const page = await openKept(context)
    // A piece of html gets no script from the service, so its frame never
    // says it is stored: the viewer keeps nothing for this version.
    const next = await seedDeployment(world.db, 'talk')
    await world.putFiles(next, {
      'index.html': ['text/html; charset=utf-8', '<h1 id="title">Piece</h1>'],
    })
    await orm
      .update(decks)
      .set({ public_deployment_id: next })
      .where(eq(decks.id, 'talk'))
    await page.goto(world.viewer('talk'))
    await hasText(page.frameLocator('iframe#deck').locator('#title'), 'Piece')
    await expect
      .poll(async () => (await recordsOf(page)).length, { timeout: 20_000 })
      .toBe(0)
    offline(first, next)
    await expect(page.goto(world.viewer('talk'))).rejects.toThrow()
  })
})

const withdrawals: [string, () => Promise<unknown>][] = [
  [
    'F37-AC7 (made private)',
    () =>
      orm
        .update(decks)
        .set({ public_deployment_id: null })
        .where(eq(decks.id, 'talk')),
  ],
  [
    'F37-AC8 (hidden by an operator)',
    () =>
      applyOperatorCommand(world.db, {
        deckId: 'talk',
        command: { kind: 'hide', reason: 'test', operator: 'operator' },
        now: 1,
      }),
  ],
]

test.each(withdrawals)(
  '%s: Given a viewer opened once, When the service stops showing the deck and it is opened again, Then the deck is forgotten, its version cleared, and no stored version shows with no connection',
  async (_, withdraw) => {
    await withContext(async (context) => {
      const page = await openKept(context)
      await withdraw()
      await page.goto(world.viewer('talk'))
      await expect.poll(() => page.locator('iframe#deck').count()).toBe(0)
      await expect
        .poll(async () => (await recordsOf(page)).length, { timeout: 20_000 })
        .toBe(0)
      // Another viewer's run clears the version that was forgotten.
      await page.goto(world.viewer('other'))
      await expect
        .poll(async () => (await recordsOf(page)).map((r) => r.key), {
          timeout: 30_000,
        })
        .toContain(KEY('other'))
      await expect.poll(() => evictionsOf(page), { timeout: 30_000 }).toBe(0)
      offline(first)
      await expect(page.goto(world.viewer('talk'))).rejects.toThrow()
    })
  },
)

test('F37-AC9: Given a viewer opened once, When the service answers 403 for the deck, Then the deck is forgotten and nothing stored shows', async () => {
  await withContext(async (context) => {
    const page = await openKept(context)
    states.set('management', 403)
    await page.goto(world.viewer('talk'))
    await expect
      .poll(async () => (await recordsOf(page)).length, { timeout: 20_000 })
      .toBe(0)
    states.set('management', 'down')
    await expect(page.goto(world.viewer('talk'))).rejects.toThrow()
  })
})

test('F37-AC10: Given a viewer kept more than a day ago, When it is opened with no connection, Then nothing stored shows', async () => {
  await withContext(async (context) => {
    const page = await openKept(context)
    // The viewer keeps its shell again each time the frame says it is stored,
    // and the frame can say so a second time after the first record shows (it
    // is asked twice, and a loaded runner is slow). Such a late write would
    // make the aged record fresh again. Emptying the frame stops the viewer
    // from hearing it, and the wait lets a write already started finish.
    await page.evaluate(
      () =>
        new Promise<void>((done) => {
          document
            .querySelector('iframe#deck')
            ?.setAttribute('src', 'about:blank')
          setTimeout(done, 1000)
        }),
    )
    await page.evaluate(
      async ([name, header, age]) => {
        const cache = await caches.open(name as string)
        for (const request of await cache.keys()) {
          const entry = await cache.match(request)
          if (!entry) continue
          const headers = new Headers(entry.headers)
          headers.set(
            header as string,
            String(Date.now() - (age as number) - 1000),
          )
          await cache.put(
            request,
            new Response(await entry.text(), { headers }),
          )
        }
      },
      [VIEWER_CACHE, STORED_AT_HEADER, OFFLINE_MAX_AGE_MS],
    )
    offline(first)
    await expect(page.goto(world.viewer('talk'))).rejects.toThrow()
    // The shell past its day is gone, and its version waits to be cleared:
    // while that version does not answer, it stays on the list.
    states.clear()
    states.set(first, 'down')
    const next = await context.newPage()
    await next.goto(world.viewer('other'))
    await expect
      .poll(async () => (await recordsOf(next)).map((r) => r.key), {
        timeout: 30_000,
      })
      .toEqual([KEY('other')])
    expect(await evictionsOf(next)).toBe(1)
    states.clear()
    await next.goto(world.viewer('other'))
    await expect.poll(() => evictionsOf(next), { timeout: 30_000 }).toBe(0)
  })
})

test('F37-AC11: Given 20 versions kept, When a 21st is opened, Then the one opened longest ago is dropped and its version cleared', async () => {
  await withContext(async (context) => {
    const page = await openKept(context, 'other')
    const fakes = Array.from({ length: OFFLINE_MAX_VERSIONS }, (_, n) => ({
      key: `http://localhost:${world.port}/@owner/fake-${n}`,
      origin: world.origin(
        `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      ),
      // Hours old, the oldest last.
      at: Date.now() - (n + 1) * 60 * 60 * 1000 + 30 * 60 * 1000,
    }))
    await page.evaluate(
      async ([name, rows, stored, from]) => {
        const cache = await caches.open(name as string)
        for (const row of rows as typeof fakes)
          await cache.put(
            row.key,
            new Response('<!doctype html>', {
              headers: {
                [stored as string]: String(row.at),
                [from as string]: row.origin,
              },
            }),
          )
      },
      [VIEWER_CACHE, fakes, STORED_AT_HEADER, CONTENT_ORIGIN_HEADER],
    )
    expect((await recordsOf(page)).length).toBe(OFFLINE_MAX_VERSIONS + 1)
    await page.goto(world.viewer('talk'))
    // The new one is put first and the oldest dropped after, so the count is
    // read once it has settled, not when the new one first shows.
    await expect
      .poll(async () => (await recordsOf(page)).map((r) => r.key), {
        timeout: 30_000,
      })
      .toSatisfy(
        (keys: string[]) =>
          keys.includes(KEY('talk')) && keys.length === OFFLINE_MAX_VERSIONS,
      )
    const keys = (await recordsOf(page)).map((r) => r.key)
    expect(keys).toHaveLength(OFFLINE_MAX_VERSIONS)
    expect(keys).not.toContain(fakes[OFFLINE_MAX_VERSIONS - 1]!.key)
    expect(keys).toContain(KEY('other'))
    await expect.poll(() => evictionsOf(page), { timeout: 30_000 }).toBe(0)
  })
})

test('F37-AC17: Given a browser with no service worker, When the viewer is opened, Then it shows as it did, with no error and nothing kept', async () => {
  await withContext(async (context) => {
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'serviceWorker', {
        value: undefined,
      })
    })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(world.viewer('talk'))
    await hasText(page.frameLocator('iframe#deck').locator('#title'), 'First')
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(errors).toEqual([])
    expect((await recordsOf(page)).length).toBe(0)
  })
})

test('F37-AC4, D-121: Given a viewer opened once, When the operator puts the service in maintenance, Then the real 503 is what the viewer and its version answer with, and the stored version shows with the band; when it ends, the live viewer is back', async () => {
  await withContext(async (context) => {
    const page = await openKept(context)
    world.setMaintenance('on;until=2999-01-01T00:00:00Z;reason=update')
    // The form of the answer that this reading depends on (docs/dev/maintenance.md).
    for (const url of [world.viewer('talk'), `${world.origin(first)}/`]) {
      const answer = await fetch(url)
      expect(answer.status).toBe(503)
      expect(answer.headers.get('X-Slide-Maintenance')).toMatch(/^on/)
      expect(answer.headers.get('Retry-After')).toMatch(/^[0-9]+$/)
    }
    await page.goto(world.viewer('talk'))
    await hasText(shellFrame(page).locator('#title'), 'First')
    await hasText(band(page), '保存した版')
    // A deck never opened has nothing stored, so the maintenance page shows.
    await page.goto(world.viewer('other'))
    expect(await page.textContent('body')).toContain('メンテナンス')
    world.setMaintenance(undefined)
    await page.goto(world.viewer('talk'))
    await expect.poll(() => page.locator('iframe#deck').count()).toBe(1)
    expect(await band(page).evaluate((slot) => slot.childElementCount)).toBe(0)
  })
})
