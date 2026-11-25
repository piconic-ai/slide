import { afterAll, beforeAll, expect, test } from 'vitest'
import { chromium, type Browser, type Locator } from 'playwright'
import { drizzle } from 'drizzle-orm/d1'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { eq } from 'drizzle-orm'
import { deployments, uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

// The page is public/index.html from `pnpm build`; CI builds before testing.
const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB

// A red 2×1 PNG.
const IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
)

/**
 * The browser binding is a stand-in that answers with a fixed image or
 * fails: a real browser drawing a deck is checked after a deploy.
 */
let shotFails = false
/** While set, an image under /covers/ is answered only once it resolves. */
let holdCovers: Promise<void> | null = null
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  BROWSER: {
    shoot: async () =>
      shotFails
        ? new Response('{}', { status: 500 })
        : new Response(IMAGE, { headers: { 'Content-Type': 'image/jpeg' } }),
  },
} as unknown as Env

// Would run if the top page framed the deck.
const DECK = `<!doctype html><title>Talk</title>
  <script>top.location = 'https://elsewhere.example/'</script>`

async function putFile(
  deployment: string,
  id: string,
  path: string,
  mediaType: string,
  body: string | Buffer,
) {
  const bytes = Buffer.from(body)
  const key = `${deployment}/${id}/lease`
  await platform.env.UPLOADS.put(key, bytes)
  await drizzle(db)
    .insert(uploadFiles)
    .values({
      deployment_id: deployment,
      id,
      path,
      size: bytes.length,
      sha256: Buffer.from(
        await crypto.subtle.digest('SHA-256', bytes),
      ).toString('hex'),
      media_type: mediaType,
      object_key: key,
    })
}

let browser: Browser
beforeAll(async () => {
  await applyMigrations(db)
  await resetTables(db)
  // Signing in records the handle "owner".
  await signIn(env)
  // The newer deck names no cover; the older one names a file of its own.
  const talk = await seedPublic(db, 'talk', 100, 'Talk')
  await putFile(talk, '0', 'index.html', 'text/html; charset=utf-8', DECK)
  const pictured = await seedPublic(db, 'pictured', 50, 'Pictured')
  await putFile(pictured, '0', 'index.html', 'text/html; charset=utf-8', DECK)
  await putFile(pictured, '1', 'cover.png', 'image/png', IMAGE)
  await drizzle(db)
    .update(deployments)
    .set({ cover_path: 'cover.png' })
    .where(eq(deployments.id, pictured))
  browser = await chromium.launch()
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

/** The top page, with the requests it makes answered by the Worker. */
async function openTopPage() {
  const page = await browser.newPage()
  const errors: string[] = []
  const asked: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    const served =
      url.origin === TEST_ORIGIN || url.hostname.endsWith('.content.example')
    if (!served) return route.abort()
    asked.push(`${url.hostname}${url.pathname}`)
    if (url.pathname.startsWith('/covers/')) await holdCovers
    // Miniflare's local proxy refuses an Origin outside its own hostnames.
    const { origin: _origin, ...headers } = await route.request().allHeaders()
    const response = await server.fetch(new Request(url, { headers }), env)
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  await page.goto(`${TEST_ORIGIN}/`)
  return { page, errors, asked }
}

// Other browser tests run at the same time.
const SETTLE = { timeout: 10000 }

const drawnWidth = (image: Locator) =>
  image.evaluate((img: HTMLImageElement) => img.naturalWidth)

async function expectDrawnCover(cover: Locator, name: string, path: RegExp) {
  const image = cover.locator('img[data-cover]')
  await expect.poll(() => drawnWidth(image), SETTLE).toBe(2)
  const src = await image.evaluate((img: HTMLImageElement) => img.src)
  expect(new URL(src).pathname).toMatch(path)
  expect(await image.isVisible()).toBe(true)
  expect(await cover.locator('.deck-cover-name').textContent()).toBe(name)
  const [box, drawn] = await Promise.all([
    cover.boundingBox(),
    image.boundingBox(),
  ])
  expect(Math.round(drawn?.width ?? 0)).toBe(Math.round(box?.width ?? -1))
  expect(Math.round(drawn?.height ?? 0)).toBe(Math.round(box?.height ?? -1))
}

test('F03-AC10: Given a cover that cannot be read, When the top page opens, Then the face with the deck’s name shows, no broken image does, and the card still links to its viewer', async () => {
  shotFails = true
  const { page } = await openTopPage()

  const card = page.locator('.recent-list .deck-card').first()
  const face = card.locator('.deck-cover-name')
  // The list replaces its placeholders, then the image fails and is hidden.
  await expect.poll(() => face.textContent(), SETTLE).toBe('Talk')
  const image = card.locator('img[data-cover]')
  await expect.poll(() => image.isHidden(), SETTLE).toBe(true)
  expect(await face.isVisible()).toBe(true)
  // The face is white on the stage colour, centred in the cover.
  expect(
    await face.evaluate((node) => {
      const style = getComputedStyle(node)
      return [style.color, style.fontSize, style.fontWeight, style.textAlign]
    }),
  ).toEqual(['rgb(255, 255, 255)', '13px', '700', 'center'])
  await card.locator('a.card-title').click()
  await page.waitForURL(`${TEST_ORIGIN}/@owner/talk`)
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await page.close()
}, 20000)

test('F03-AC42, F03-AC46, F03-AC48: Given a generated cover still on its way and a supplied cover, When they load, Then the name gives way to the image without resizing and both covers open their viewer', async () => {
  shotFails = false
  let arrive = () => {}
  holdCovers = new Promise<void>((resolve) => (arrive = resolve))
  try {
    const { page, errors, asked } = await openTopPage()

    const card = page.locator('.recent-list .deck-card').first()
    const cover = card.locator('.deck-cover')
    const face = card.locator('.deck-cover-name')
    await expect.poll(() => face.textContent(), SETTLE).toBe('Talk')
    const image = cover.locator('img[data-cover]')
    // Waiting: the face shows and the image has drawn nothing.
    expect(await face.isVisible()).toBe(true)
    expect(await drawnWidth(image)).toBe(0)
    const before = await card.boundingBox()

    arrive()
    await expectDrawnCover(cover, 'Talk', /^\/covers\/[0-9a-f-]{36}\.jpg$/)
    expect(before).not.toBeNull()
    expect(await card.boundingBox()).toEqual(before)

    const pictured = page
      .locator('.recent-list .deck-card')
      .nth(1)
      .locator('.deck-cover')
    await expectDrawnCover(pictured, 'Pictured', /^\/cover\.png$/)
    expect(await page.locator('iframe').count()).toBe(0)
    expect(asked.filter((path) => path.endsWith('.content.example/'))).toEqual(
      [],
    )
    expect(errors).toEqual([])

    await cover.click()
    await page.waitForURL(`${TEST_ORIGIN}/@owner/talk`)
    await page.goBack()
    await expect
      .poll(() => drawnWidth(pictured.locator('img[data-cover]')), SETTLE)
      .toBe(2)
    await pictured.click()
    await page.waitForURL(`${TEST_ORIGIN}/@owner/pictured`)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await page.close()
  } finally {
    arrive()
    holdCovers = null
  }
}, 20000)
