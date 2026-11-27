import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { openTestBrowser } from '../test-open-browser'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { chromium, type Browser, type Page, type Route } from 'playwright'
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
  { slug: 'peitho', dir: 'peitho', three: 'charlie', four: 'delta' },
]

let browser: Browser
const inventories = new Map<
  string,
  ReturnType<typeof parseInventoryStructure>
>()
beforeAll(async () => {
  await applyMigrations(db)
  await signIn(env)
  for (const [index, tool] of TOOLS.entries()) {
    const built = await readBuilt(join(TOOLS_DIR, tool.dir, 'dist'))
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
  'F03-AC4, F03-AC143, F03-AC174: Given the real output of $slug, When the reader opens /@owner/$slug/3 and turns a page, Then page 3 shows and the address becomes /4',
  async ({ slug, three, four }) => {
    await withPage(async (page) => {
      await page.goto(`${TEST_ORIGIN}/@owner/${slug}/3`)
      const deck = page.frameLocator('iframe#deck')
      await expect
        .poll(() => deck.locator('body').innerText(), { timeout: 20000 })
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
        .poll(() => deck.locator('body').innerText(), { timeout: 20000 })
        .toContain(four)
      await page.waitForURL((url) => url.pathname === `/@owner/${slug}/4`)
    })
  },
  60000,
)
