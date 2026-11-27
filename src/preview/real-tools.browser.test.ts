import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { openTestBrowser } from '../test-open-browser'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  chromium,
  type Browser,
  type FrameLocator,
  type Page,
  type Route,
} from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { DEFAULT_UPLOAD_LIMITS } from '../uploads/limits'
import { parseInventoryStructure } from '../uploads/inventory'
import {
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

// Slides built by real tools, kept as they came out of the tool
// (scripts/fixtures/tools/<tool>/, with the source and how to rebuild).
// The viewer's page handling is checked on them, not on a hand-written
// imitation of what a tool does (#694).
const TOOLS_DIR = 'scripts/fixtures/tools'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const open_ = { limit: async () => ({ success: true }) }
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  VIEWER_RATE_LIMITER: open_,
  CONTENT_RATE_LIMITER: open_,
} as unknown as Env

/** Every file of a built tool output, by its path in the upload. */
async function readBuilt(dir: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>()
  const walk = async (current: string) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) await walk(path)
      else
        files.set(
          relative(dir, path).split(sep).join('/'),
          await readFile(path),
        )
    }
  }
  await walk(dir)
  return files
}

async function sha256Hex(bytes: Buffer) {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}

/** Stores a built output as a finished upload would: real sizes, hashes, types. */
async function store(id: string, built: Map<string, Buffer>) {
  const inventory = parseInventoryStructure({
    entry: 'index.html',
    files: await Promise.all(
      [...built].map(async ([path, bytes]) => ({
        path,
        size: bytes.byteLength,
        sha256: await sha256Hex(bytes),
      })),
    ),
  })
  for (const [index, file] of inventory.files.entries()) {
    const key = `${id}/${index}/lease`
    await platform.env.UPLOADS.put(key, built.get(file.path)!)
    await orm.insert(uploadFiles).values({
      deployment_id: id,
      id: String(index),
      path: file.path,
      size: file.size,
      sha256: file.sha256,
      media_type: file.mediaType,
      object_key: key,
    })
  }
  return inventory
}

/** What each tool's page 3 and page 4 show, by the word in the source. */
const TOOLS = [
  {
    slug: 'peitho',
    dir: 'peitho',
    shown: 'body',
    // peitho keeps the page in the query (?slide=N).
    acs: 'F03-AC4, F03-AC143, F03-AC174',
    three: 'charlie',
    four: 'delta',
  },
  // One HTML file holding every page; the page on show is marked.
  {
    slug: 'marp',
    dir: 'marp',
    shown: '.bespoke-marp-active section',
    // Marp keeps the page in the fragment (#N), the form the service reads first.
    acs: 'F03-AC4, F03-AC143',
    three: 'charlie',
    four: 'delta',
  },
]

/**
 * Tools whose way of keeping the page the service's rules do not cover
 * (#694, open question 2). Their tests record what happens now; they do not
 * say what should happen. `apart` lists output files left out of the upload.
 */
const RECORDED: {
  slug: string
  dir: string
  apart: string[]
  seen: Observed
}[] = [
  {
    slug: 'slidev',
    dir: 'slidev',
    apart: ['_redirects'],
    // Slidev keeps the page in the path (/2); the fragment it was opened with
    // is dropped when it redirects to /1, so the viewer is told nothing more.
    seen: {
      opened: ['alpha'],
      openedFrame: '/1#3',
      turned: ['bravo'],
      turnedFrame: '/2',
      address: '/@owner/slidev',
    },
  },
  // suraido.js counts pages from 0 in the fragment (#3 is the fourth page),
  // and writes it with history.replaceState as the reader turns pages.
  {
    slug: 'suraido',
    dir: 'suraido',
    apart: [],
    seen: {
      opened: ['delta'],
      openedFrame: '/#3',
      turned: ['echo'],
      turnedFrame: '/#4',
      address: '/@owner/suraido/4',
    },
  },
]

/** What a reader sees of slides of one of these tools, opened at page 3. */
type Observed = {
  opened: string[]
  openedFrame: string
  turned: string[]
  turnedFrame: string
  address: string
}

let browser: Browser
const inventories = new Map<
  string,
  ReturnType<typeof parseInventoryStructure>
>()
beforeAll(async () => {
  await applyMigrations(db)
  await signIn(env)
  for (const [index, tool] of [...TOOLS, ...RECORDED].entries()) {
    const built = await readBuilt(join(TOOLS_DIR, tool.dir, 'dist'))
    for (const path of 'apart' in tool ? tool.apart : []) built.delete(path)
    const id = await seedPublic(db, tool.slug, index + 1, tool.slug)
    inventories.set(tool.slug, await store(id, built))
  }
  browser = await openTestBrowser(chromium)
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

const isServed = (url: URL) =>
  url.hostname === 'slide.example' || url.hostname.endsWith('.content.example')

/** Answers browser requests with the Worker, as Cloudflare would. */
async function serve(route: Route) {
  const request = route.request()
  const url = new URL(request.url())
  if (!isServed(url)) return route.abort()
  const headers = await request.allHeaders()
  if (request.isNavigationRequest() && request.frame().parentFrame())
    headers['sec-fetch-dest'] ??= 'iframe'
  const response = await server.fetch(
    new Request(url, { method: request.method(), headers, redirect: 'manual' }),
    env,
  )
  await route.fulfill({
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: Buffer.from(await response.arrayBuffer()),
  })
}

async function withPage(use: (page: Page) => Promise<void>) {
  const context = await browser.newContext()
  try {
    await context.route('**/*', serve)
    await use(await context.newPage())
  } finally {
    await context.close()
  }
}

test.each(TOOLS)(
  'F22-AC6: Given the $slug fixture, When it is read as an upload, Then it is within the limits of one version',
  ({ slug }) => {
    const inventory = inventories.get(slug)!
    expect(inventory.files.length).toBeLessThanOrEqual(
      DEFAULT_UPLOAD_LIMITS.files,
    )
    expect(inventory.totalBytes).toBeLessThanOrEqual(
      DEFAULT_UPLOAD_LIMITS.deploymentBytes,
    )
    for (const file of inventory.files)
      expect(file.size).toBeLessThanOrEqual(DEFAULT_UPLOAD_LIMITS.fileBytes)
  },
)

test.each(TOOLS)(
  '$acs: Given the real output of $slug, When the reader opens /@owner/$slug/3 and turns a page, Then page 3 shows and the address becomes /4',
  async ({ slug, shown, three, four }) => {
    await withPage(async (page) => {
      await page.goto(`${TEST_ORIGIN}/@owner/${slug}/3`)
      const deck = page.frameLocator('iframe#deck')
      await expect
        .poll(() => deck.locator(shown).innerText(), { timeout: 20000 })
        .toContain(three)
      // Reading page 3 has not turned the address on its own.
      expect(new URL(page.url()).pathname).toBe(`/@owner/${slug}/3`)
      // The key is sent as an event in the frame, as peitho's own handler
      // reads it: a key pressed through the browser goes to the page that
      // holds the focus, which is not the frame until a reader clicks it.
      await deck
        .locator('body')
        .dispatchEvent('keydown', { key: 'ArrowRight', bubbles: true })
      await expect
        .poll(() => deck.locator(shown).innerText(), { timeout: 20000 })
        .toContain(four)
      await page.waitForURL((url) => url.pathname === `/@owner/${slug}/4`)
    })
  },
  60000,
)

const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo']

/** Which pages' words are on show in the slides' frame. */
async function wordsShown(deck: FrameLocator) {
  const text = await deck.locator('body').innerText()
  return WORDS.filter((word) => text.includes(word))
}

/** Where the slides' frame is, without its origin. */
const frameAt = (page: Page) => {
  const url = new URL(
    page
      .frames()
      .find((frame) => frame.url().includes('.content.example'))!
      .url(),
  )
  return url.pathname + url.search + url.hash
}

const RECORD_NOTE =
  'A record of what happens now, not an expectation: the spec has not decided how these slides should behave (#694, open question 2)'

test.each(RECORDED)(
  `${RECORD_NOTE}. Given the real output of $slug, When the reader opens /@owner/$slug/3 and presses the right arrow once, Then the slides and addresses are as recorded`,
  async ({ slug, seen }) => {
    await withPage(async (page) => {
      await page.goto(`${TEST_ORIGIN}/@owner/${slug}/3`)
      const deck = page.frameLocator('iframe#deck')
      await expect
        .poll(() => wordsShown(deck), { timeout: 20000 })
        .not.toEqual([])
      // Let the slides settle where they redirect themselves.
      await new Promise((resolve) => setTimeout(resolve, 1500))
      expect({
        opened: await wordsShown(deck),
        openedFrame: frameAt(page),
      }).toEqual({ opened: seen.opened, openedFrame: seen.openedFrame })
      // A key as the reader presses it: the frame holds the focus. An event
      // sent to the frame would reach tools that listen twice, twice.
      await page.locator('iframe#deck').focus()
      await page
        .frames()
        .find((frame) => frame.url().includes('.content.example'))!
        .evaluate(() => window.focus())
      await page.keyboard.press('ArrowRight')
      await new Promise((resolve) => setTimeout(resolve, 1500))
      expect({
        turned: await wordsShown(deck),
        turnedFrame: frameAt(page),
        address: new URL(page.url()).pathname,
      }).toEqual({
        turned: seen.turned,
        turnedFrame: seen.turnedFrame,
        address: seen.address,
      })
    })
  },
  60000,
)

test(`${RECORD_NOTE}. Given Slidev's output as built, When it is read as an upload, Then \`_redirects\` is refused as a file type, and the rest is within the limits of one version (F22-AC6)`, async () => {
  const built = await readBuilt(join(TOOLS_DIR, 'slidev', 'dist'))
  expect([...built.keys()]).toContain('_redirects')
  const inventoryOf = (files: Map<string, Buffer>) =>
    parseInventoryStructure({
      entry: 'index.html',
      files: [...files].map(([path, bytes]) => ({
        path,
        size: bytes.byteLength,
        sha256: 'a'.repeat(64),
      })),
    })
  expect(() => inventoryOf(built)).toThrow('Unsupported static file type')
  built.delete('_redirects')
  const inventory = inventoryOf(built)
  expect(inventory.files.length).toBe(42)
  expect(inventory.files.length).toBeLessThanOrEqual(
    DEFAULT_UPLOAD_LIMITS.files,
  )
  expect(inventory.totalBytes).toBeLessThanOrEqual(
    DEFAULT_UPLOAD_LIMITS.deploymentBytes,
  )
})
