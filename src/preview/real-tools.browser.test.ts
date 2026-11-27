import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { openTestBrowser } from '../test-open-browser'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  chromium,
  type Browser,
  type Frame,
  type FrameLocator,
  type Page,
  type Route,
} from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { keepArticle } from '../articles/store'
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
 * reveal.js outputs, each as a slide of its own (the variants of
 * scripts/fixtures/tools/revealjs). They differ in how the page initializes
 * reveal.js: its defaults, which do not write the address; `hash: true`,
 * which writes it from 0; `hashOneBasedIndex: true`, which counts from 1.
 */
const SURAIDO = [
  { slug: 'suraido', dir: 'suraido', apart: [] },
  // The same output without the class of its built-in layout (<Pad>): its
  // own elements carry no class of its name, as slides that write plain HTML
  // do not (the bundle's one word of it is changed; nothing else is).
  { slug: 'suraido-plain', dir: 'suraido', apart: [], plain: true },
]

const SLIDEV = [
  // `_redirects` is left out of the upload until the service takes a build
  // with it as it is (#710); it is no part of what is checked here.
  { slug: 'slidev', dir: 'slidev', apart: ['_redirects'] },
]

const REVEAL = [
  { slug: 'revealjs', dist: 'dist', acs: 'F03-AC187, F03-AC188' },
  {
    slug: 'revealjs-hash',
    dist: 'dist-hash',
    acs: 'F03-AC187, F03-AC188, F03-AC189',
  },
  {
    slug: 'revealjs-one-based',
    dist: 'dist-one-based',
    acs: 'F03-AC187, F03-AC188, F03-AC189',
  },
  { slug: 'revealjs-fragments', dist: 'dist-fragments', acs: 'F03-AC190' },
  // Slides one above the other: [1, 3, 1] and [2, 1, 2] slides per column.
  { slug: 'revealjs-vertical', dist: 'dist-vertical', acs: 'F03-AC199' },
  {
    slug: 'revealjs-vertical-edges',
    dist: 'dist-vertical-edges',
    acs: 'F03-AC199',
  },
]

/** The files of a tool's built output, as they are put up. */
async function builtOf(tool: {
  dir?: string
  dist?: string
  apart?: string[]
  plain?: boolean
}) {
  const dir = tool.dist ? `revealjs/${tool.dist}` : `${tool.dir}/dist`
  const built = await readBuilt(join(TOOLS_DIR, dir))
  for (const path of tool.apart ?? []) built.delete(path)
  if (tool.plain) {
    for (const [path, bytes] of built)
      if (path.endsWith('.js'))
        built.set(
          path,
          Buffer.from(bytes.toString().replaceAll('suraido-pad', 'pad-plain')),
        )
  }
  return built
}

let browser: Browser
/** The version each slide was stored as, by slug. */
const deployments = new Map<string, string>()
const inventories = new Map<
  string,
  ReturnType<typeof parseInventoryStructure>
>()
beforeAll(async () => {
  await applyMigrations(db)
  await signIn(env)
  for (const [index, tool] of [
    ...TOOLS,
    ...SURAIDO,
    ...REVEAL,
    ...SLIDEV,
  ].entries()) {
    const built = await builtOf(tool)
    const id = await seedPublic(db, tool.slug, index + 1, tool.slug)
    inventories.set(tool.slug, await store(id, built))
    deployments.set(tool.slug, id)
    // An article with pages 3 and 5 of the slides as images (F03-AC193).
    await keepArticle(db, {
      deckId: tool.slug,
      status: 'published',
      citations: [],
      now: 5,
      body: [
        '# Notes',
        `${TEST_ORIGIN}/@owner/${tool.slug}/3`,
        `${TEST_ORIGIN}/@owner/${tool.slug}/5`,
      ].join('\n\n'),
    })
  }
  // A piece of HTML with no document around it: the service serves it as it
  // was put up, with no page script in it (F03-AC153).
  const piece = await seedPublic(db, 'piece', 90, 'piece')
  inventories.set(
    'piece',
    await store(
      piece,
      new Map([['index.html', Buffer.from('<h1>piece</h1>')]]),
    ),
  )
  await keepArticle(db, {
    deckId: 'piece',
    status: 'published',
    citations: [],
    now: 5,
    body: [
      '# Notes',
      `${TEST_ORIGIN}/@owner/piece/3`,
      `${TEST_ORIGIN}/@owner/piece/5`,
    ].join('\n\n'),
  })
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

test.each([...TOOLS, ...SURAIDO, ...REVEAL, ...SLIDEV])(
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

/** Presses a key as the reader does: the frame holds the focus. */
async function pressInDeck(page: Page, key: string) {
  await page.locator('iframe#deck').focus()
  await page
    .frames()
    .find((frame) => frame.url().includes('.content.example'))!
    .evaluate(() => window.focus())
  await page.keyboard.press(key)
}

const addressOf = (page: Page) => new URL(page.url()).pathname

/** The slide on show in reveal.js, by the words in its text. */
const revealShown = (deck: FrameLocator) =>
  deck
    .locator('.reveal .slides section.present')
    .last()
    .innerText()
    // The theme sets capitals.
    .then((text) => text.toLowerCase())

test.each(REVEAL.filter((_, index) => index < 3))(
  '$acs: Given the real output of reveal.js ($slug), When the reader opens /@owner/$slug/3 and turns a page, Then page 3 shows, the address stays at 3, and it becomes /4 after the turn',
  async ({ slug }) => {
    await withPage(async (page) => {
      await page.goto(`${TEST_ORIGIN}/@owner/${slug}/3`)
      const deck = page.frameLocator('iframe#deck')
      await expect
        .poll(() => revealShown(deck), { timeout: 20000 })
        .toContain('charlie')
      // Settle: the slides are not moved on after they show page 3.
      await new Promise((resolve) => setTimeout(resolve, 1000))
      expect(await revealShown(deck)).toContain('charlie')
      expect(addressOf(page)).toBe(`/@owner/${slug}/3`)
      await pressInDeck(page, 'ArrowRight')
      await expect
        .poll(() => revealShown(deck), { timeout: 20000 })
        .toContain('delta')
      await page.waitForURL((url) => url.pathname === `/@owner/${slug}/4`)
      await pressInDeck(page, 'ArrowLeft')
      await page.waitForURL((url) => url.pathname === `/@owner/${slug}/3`)
    })
  },
  60000,
)

test('F03-AC191, F03-AC192: Given the real output of Slidev, When the reader opens /@owner/slidev/3 and turns a page, Then page 3 shows with the address at 3, and going on shows page 4 with the address at /4', async () => {
  await withPage(async (page) => {
    await page.goto(`${TEST_ORIGIN}/@owner/slidev/3`)
    const deck = page.frameLocator('iframe#deck')
    await expect
      .poll(() => wordsShown(deck), { timeout: 20000 })
      .toEqual(['charlie'])
    // Slidev redirects a path of its own after it starts: let it settle.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(await wordsShown(deck)).toEqual(['charlie'])
    expect(addressOf(page)).toBe('/@owner/slidev/3')
    expect(new URL(frameAt(page), 'https://x').pathname).toBe('/3')
    await pressInDeck(page, 'ArrowRight')
    await expect
      .poll(() => wordsShown(deck), { timeout: 20000 })
      .toEqual(['delta'])
    await page.waitForURL((url) => url.pathname === '/@owner/slidev/4')
    await pressInDeck(page, 'ArrowLeft')
    await page.waitForURL((url) => url.pathname === '/@owner/slidev/3')
  })
}, 60000)

test.each(['suraido', 'suraido-plain'])(
  'F03-AC184, F03-AC185, F03-AC186: Given the real output of suraido.js (%s), When the reader opens /@owner/<slug>/3, turns to page 4 and back to page 1, Then page 3 shows with the address at 3, then /4, then no number',
  async (slug) => {
    await withPage(async (page) => {
      await page.goto(`${TEST_ORIGIN}/@owner/${slug}/3`)
      const deck = page.frameLocator('iframe#deck')
      await expect
        .poll(() => wordsShown(deck), { timeout: 20000 })
        .toEqual(['charlie'])
      // Settled: the slides were recognised and moved on to page 3, if they
      // showed another first (the address is not the slides' to change).
      await new Promise((resolve) => setTimeout(resolve, 1500))
      expect(await wordsShown(deck)).toEqual(['charlie'])
      expect(addressOf(page)).toBe(`/@owner/${slug}/3`)
      await pressInDeck(page, 'ArrowRight')
      await expect
        .poll(() => wordsShown(deck), { timeout: 20000 })
        .toEqual(['delta'])
      await page.waitForURL((url) => url.pathname === `/@owner/${slug}/4`)
      for (let back = 0; back < 3; back++) await pressInDeck(page, 'ArrowLeft')
      await expect
        .poll(() => wordsShown(deck), { timeout: 20000 })
        .toEqual(['alpha'])
      await page.waitForURL((url) => url.pathname === `/@owner/${slug}`)
    })
  },
  60000,
)

// The article's images of pages move the slides, as the address does when
// they are opened (F03-AC193). Each is pressed after the other, so the move
// is made in slides that are already running.
test.each([
  ['suraido.js', 'suraido', ['charlie', 'echo', 'charlie']],
  ['reveal.js', 'revealjs', ['charlie', 'echo', 'charlie']],
  ['Slidev', 'slidev', ['charlie', 'echo', 'charlie']],
])(
  'F03-AC193: Given the real output of %s with an article holding images of pages 3 and 5, When the reader presses them in turn, Then the slides move to page 3, 5 and 3 again, and the address follows',
  async (_name, slug, words) => {
    await withPage(async (page) => {
      // The viewer scrolls to the slides smoothly: a click made while it
      // moves can miss, which is not what is checked here.
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto(`${TEST_ORIGIN}/@owner/${slug}`)
      const deck = page.frameLocator('iframe#deck')
      await expect
        .poll(() => wordsShown(deck), { timeout: 20000 })
        .toEqual(['alpha'])
      // Let the slides settle where they put their own address.
      await new Promise((resolve) => setTimeout(resolve, 1500))
      for (const [at, pressed] of [3, 5, 3].entries()) {
        // The link's own click, as the page's script sees it: pressing it by
        // its place on the screen can miss while the viewer scrolls.
        await page
          .getByRole('link', { name: `スライドの ${pressed} ページへ移る` })
          .first()
          .evaluate((link) => (link as HTMLElement).click())
        await expect
          .poll(() => wordsShown(deck), { timeout: 20000 })
          .toEqual([words[at]])
        await page.waitForURL(
          (url) => url.pathname === `/@owner/${slug}/${pressed}`,
        )
      }
    })
  },
  60000,
)

// Slides of no tool the service reads (peitho keeps its page in the query, as
// the slides were opened; Marp in the fragment) are moved as before: by the
// address of the top of the version with the page as the fragment.
test.each([
  ['peitho', 'body'],
  ['marp', '.bespoke-marp-active section'],
])(
  'F03-AC193: Given the real output of %s with an article holding images of pages 3 and 5, When the reader presses them in turn, Then the slides move to page 3, 5 and 3 again',
  async (slug, shown) => {
    await withPage(async (page) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto(`${TEST_ORIGIN}/@owner/${slug}`)
      const deck = page.frameLocator('iframe#deck')
      await expect
        .poll(() => deck.locator(shown).innerText(), { timeout: 20000 })
        .toContain('alpha')
      await new Promise((resolve) => setTimeout(resolve, 1500))
      for (const [pressed, word] of [
        [3, 'charlie'],
        [5, 'echo'],
        [3, 'charlie'],
      ] as const) {
        await page
          .getByRole('link', { name: `スライドの ${pressed} ページへ移る` })
          .first()
          .evaluate((link) => (link as HTMLElement).click())
        await expect
          .poll(() => deck.locator(shown).innerText(), { timeout: 20000 })
          .toContain(word)
      }
    })
  },
  60000,
)

test('F03-AC193: Given the article’s images of pages 3 and 5 pressed within half a second, When the slides answer both, Then neither is moved again by the address afterwards', async () => {
  await withPage(async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`${TEST_ORIGIN}/@owner/revealjs`)
    const deck = page.frameLocator('iframe#deck')
    await expect
      .poll(() => wordsShown(deck), { timeout: 20000 })
      .toEqual(['alpha'])
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await page.evaluate(() => {
      for (const n of [3, 5])
        document
          .querySelector<HTMLElement>(`a[data-article-page="${n}"]`)!
          .click()
    })
    await expect
      .poll(() => wordsShown(deck), { timeout: 20000 })
      .toEqual(['echo'])
    // Past the wait for an answer: a move by the address would show here.
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(new URL(frameAt(page), 'https://x').hash).toBe('')
  })
}, 60000)

test('F03-AC193: Given a piece of HTML the service serves without its page script, When the reader presses the article’s images of pages 3 and 5, Then the slides are moved to /#3 and /#5 as they always were', async () => {
  await withPage(async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`${TEST_ORIGIN}/@owner/piece`)
    const deck = page.frameLocator('iframe#deck')
    await expect
      .poll(() => deck.locator('h1').innerText(), { timeout: 20000 })
      .toBe('piece')
    for (const pressed of [3, 5]) {
      await page
        .getByRole('link', { name: `スライドの ${pressed} ページへ移る` })
        .first()
        .evaluate((link) => (link as HTMLElement).click())
      await expect
        .poll(() => new URL(frameAt(page), 'https://x').hash, {
          timeout: 10000,
        })
        .toBe(`#${pressed}`)
    }
  })
}, 60000)

const OPENS_AT_THREE = [
  ['suraido.js', 'suraido'],
  ['reveal.js', 'revealjs'],
  ['Slidev', 'slidev'],
]

/** Which pages' words are on show in a frame. */
async function wordsIn(frame: Frame) {
  const text = await frame
    .locator('body')
    .innerText()
    .catch(() => '')
  return WORDS.filter((word) => text.includes(word))
}

test.each(OPENS_AT_THREE)(
  'F03-AC194: Given the real output of %s, When its version is opened as the page itself at /#3, as the capture of the page image does, Then page 3 shows',
  async (_name, slug) => {
    await withPage(async (page) => {
      await page.goto(`https://d-${deployments.get(slug)}.content.example/#3`)
      await expect
        .poll(() => wordsIn(page.mainFrame()), { timeout: 20000 })
        .toEqual(['charlie'])
      await new Promise((resolve) => setTimeout(resolve, 1000))
      expect(await wordsIn(page.mainFrame())).toEqual(['charlie'])
    })
  },
  60000,
)

test.each(OPENS_AT_THREE)(
  'F03-AC198: Given the real output of %s in an embed on another site, When /embed/@owner/<slug>/3 is opened, Then page 3 shows',
  async (_name, slug) => {
    await withPage(async (page) => {
      await page.route('https://blog.example/post', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><title>post</title><iframe src="${TEST_ORIGIN}/embed/@owner/${slug}/3" width="800" height="500"></iframe>`,
        }),
      )
      await page.goto('https://blog.example/post')
      const slides = () =>
        page.frames().find((frame) => frame.url().includes('.content.example'))
      await expect
        .poll(
          async () => {
            const frame = slides()
            return frame ? wordsIn(frame) : []
          },
          { timeout: 20000 },
        )
        .toEqual(['charlie'])
      await new Promise((resolve) => setTimeout(resolve, 1000))
      expect(await wordsIn(slides()!)).toEqual(['charlie'])
    })
  },
  60000,
)

/** The page of each slide of the vertical fixtures, by the word it shows. */
const PAGE_OF_WORD: Record<string, number> = {
  alpha: 1,
  bravo: 2,
  charlie: 3,
  delta: 4,
  echo: 5,
}
const WORD_OF_PAGE = Object.keys(PAGE_OF_WORD)

/** Opens the slides at a page and waits for the slide that should show. */
async function openRevealAt(page: Page, slug: string, at: number) {
  await page.goto(`${TEST_ORIGIN}/@owner/${slug}/${at}`)
  const deck = page.frameLocator('iframe#deck')
  await expect
    .poll(() => revealShown(deck), { timeout: 20000 })
    .toContain(WORD_OF_PAGE[at - 1])
  // Settle: the slides are not moved on after they show the page.
  await new Promise((resolve) => setTimeout(resolve, 800))
  expect(await revealShown(deck)).toContain(WORD_OF_PAGE[at - 1])
  return deck
}

// Page 1 is column 1, pages 2 to 4 are the three slides of column 2 from the
// top, page 5 is column 3 (F03-AC199).
test.each([
  [1, 'alpha'],
  [2, 'bravo'],
  [3, 'charlie'],
  [4, 'delta'],
  [5, 'echo'],
])(
  'F03-AC199: Given the real output of reveal.js with a column of three slides, When the reader opens /@owner/revealjs-vertical/%i, Then the slide of that place in reading order shows (%s) and the address stays',
  async (at, word) => {
    await withPage(async (page) => {
      const deck = await openRevealAt(page, 'revealjs-vertical', at)
      expect(await revealShown(deck)).toContain(word)
      // The first page has no number in the address.
      expect(addressOf(page)).toBe(
        at === 1
          ? '/@owner/revealjs-vertical'
          : `/@owner/revealjs-vertical/${at}`,
      )
    })
  },
  60000,
)

test('F03-AC200: Given the slides opened at the middle of the column, When the reader goes down, Then the address becomes /4', async () => {
  await withPage(async (page) => {
    const deck = await openRevealAt(page, 'revealjs-vertical', 3)
    await pressInDeck(page, 'ArrowDown')
    await expect
      .poll(() => revealShown(deck), { timeout: 20000 })
      .toContain('delta')
    await page.waitForURL(
      (url) => url.pathname === '/@owner/revealjs-vertical/4',
    )
  })
}, 60000)

test.each([
  ['the top of the column (page 2)', 2],
  ['the bottom of the column (page 4)', 4],
])(
  'F03-AC201: Given the slides opened at %s, When the reader goes right, Then the address becomes /5, past the slides of the column',
  async (_where, at) => {
    await withPage(async (page) => {
      const deck = await openRevealAt(page, 'revealjs-vertical', at)
      await pressInDeck(page, 'ArrowRight')
      await expect
        .poll(() => revealShown(deck), { timeout: 20000 })
        .toContain('echo')
      await page.waitForURL(
        (url) => url.pathname === '/@owner/revealjs-vertical/5',
      )
    })
  },
  60000,
)

test.each([
  [
    'revealjs-vertical',
    [
      'ArrowRight',
      'ArrowDown',
      'ArrowDown',
      'ArrowUp',
      'ArrowRight',
      'ArrowLeft',
      'ArrowLeft',
      'ArrowUp',
    ],
  ],
  [
    'revealjs-vertical-edges',
    [
      'ArrowDown',
      'ArrowRight',
      'ArrowRight',
      'ArrowDown',
      'ArrowUp',
      'ArrowLeft',
      'ArrowLeft',
      'ArrowUp',
    ],
  ],
])(
  'F03-AC199, F03-AC200, F03-AC201: Given the slides %s opened at page 1, When the reader goes right, down, up and left, Then after every key the address names the place of the slide that shows, in reading order',
  async (slug, keys) => {
    await withPage(async (page) => {
      const deck = await openRevealAt(page, slug, 1)
      for (const key of keys) {
        await pressInDeck(page, key)
        await new Promise((resolve) => setTimeout(resolve, 900))
        const shown = await revealShown(deck)
        const word = WORD_OF_PAGE.find((candidate) =>
          shown.includes(candidate),
        )!
        const expected =
          PAGE_OF_WORD[word] === 1
            ? `/@owner/${slug}`
            : `/@owner/${slug}/${PAGE_OF_WORD[word]}`
        expect(addressOf(page), `after ${key}, ${word} shows`).toBe(expected)
      }
    })
  },
  60000,
)

test('F03-AC190: Given the real output of reveal.js whose page 3 shows its lines one at a time, When the reader steps through them, Then the address stays at page 3 until the next page', async () => {
  await withPage(async (page) => {
    await page.goto(`${TEST_ORIGIN}/@owner/revealjs-fragments/3`)
    const deck = page.frameLocator('iframe#deck')
    await expect
      .poll(() => revealShown(deck), { timeout: 20000 })
      .toContain('charlie')
    const told: number[] = []
    await page.exposeFunction('told', (n: number) => told.push(n))
    await page.evaluate(() =>
      addEventListener('message', (event) => {
        if (event.data?.type === 'slide:page')
          (window as unknown as { told: (n: number) => void }).told(
            event.data.page,
          )
      }),
    )
    for (const step of ['first-step', 'second-step']) {
      await pressInDeck(page, 'ArrowRight')
      await expect
        .poll(() =>
          deck.locator(`.fragment.visible:has-text("${step}")`).count(),
        )
        .toBe(1)
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(addressOf(page)).toBe('/@owner/revealjs-fragments/3')
    }
    expect(told).toEqual([])
    await pressInDeck(page, 'ArrowRight')
    await expect
      .poll(() => revealShown(deck), { timeout: 20000 })
      .toContain('delta')
    await page.waitForURL(
      (url) => url.pathname === '/@owner/revealjs-fragments/4',
    )
    expect(told).toEqual([4])
  })
}, 60000)

const RECORD_NOTE =
  'A record of what happens now, not an expectation: the spec has not decided how these slides should behave (#694, open question 2)'

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
