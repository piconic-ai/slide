import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import { decks, deployments, uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { applyAuthorCommand } from '../publication/author'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'
import { VERSION_LIMITS } from '../uploads/version-limits'
import { dropFiles, openPage, type Exchange } from './test-browser'

// The pages load /drop.js and /drop-core.js from `pnpm build`; CI builds
// before testing.
const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = withInvited(testEnv(platform.env))
let browser: Browser
let cookie = ''

// Other browser tests run at the same time.
const SETTLE = { timeout: 60000 }
const ZONE = '[data-drop-zone="new"]'
const html = (title: string, body = '<h1>one</h1>') => ({
  name: 'My Talk.html',
  type: 'text/html',
  text: `<!doctype html><head><title>${title}</title></head><body>${body}</body>`,
})
// The page of a slide nobody published asks for a cover that is not there
// yet; /share.js hides the picture. Nothing else may fail.
const failures = (exchanges: readonly Exchange[]) =>
  exchanges.filter(
    ({ status, path }) => status >= 400 && !path.startsWith('/covers/'),
  )
const notACover = (error: string) => !/status of 404/.test(error)
const starts = (exchanges: readonly { method: string }[]) =>
  exchanges.filter(({ method }) => method !== 'GET')

beforeAll(async () => {
  await applyMigrations(database)
  browser = await chromium.launch()
})
beforeEach(async () => {
  await resetTables(database)
  cookie = await signIn(env, 'alice')
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

test('F22-AC1: Given a signed-in author on the top page, When they drop one HTML file, Then the page of the new slide opens and only the author can read the slide', async () => {
  const { page, errors, exchanges } = await openPage(browser, env, '/', {
    cookie,
  })
  await expect
    .poll(() => page.locator(`${ZONE} [data-drop-choose]`).isEnabled(), SETTLE)
    .toBe(true)

  await dropFiles(page, ZONE, [html('Drop Talk')])

  await page.waitForURL(`${TEST_ORIGIN}/slides/drop-talk`, SETTLE)
  await expect
    .poll(() => page.locator('h1').textContent(), SETTLE)
    .toBe('Drop Talk')
  expect(
    await db
      .select({ slug: decks.slug, public: decks.public_deployment_id })
      .from(decks),
  ).toEqual([{ slug: 'drop-talk', public: null }])
  expect(
    await db
      .select({ state: deployments.state, source: deployments.source })
      .from(deployments),
  ).toEqual([{ state: 'ready', source: 'browser' }])
  expect(failures(exchanges)).toEqual([])
  expect(errors.filter(notACover)).toEqual([])
  await page.context().close()
})

test('F22-AC2: Given a signed-in author using only the keyboard, When they reach "Choose a file" with Tab, press Enter and pick a file, Then the same happens as with a drop', async () => {
  const { page } = await openPage(browser, env, '/', { cookie })
  const choose = page.locator(`${ZONE} [data-drop-choose]`)
  await expect.poll(() => choose.isEnabled(), SETTLE).toBe(true)
  // A real button and a real file input, named for assistive technology.
  expect(await choose.evaluate((element) => element.tagName)).toBe('BUTTON')
  expect(
    await page
      .locator(`${ZONE} [data-drop-input]`)
      .evaluate((element) => (element as HTMLInputElement).type),
  ).toBe('file')
  // Tab reaches the button without a pointer.
  for (let presses = 0; presses < 30; presses++) {
    await page.keyboard.press('Tab')
    if (await choose.evaluate((element) => element === document.activeElement))
      break
  }
  expect(
    await choose.evaluate((element) => element === document.activeElement),
  ).toBe(true)

  const chooser = page.waitForEvent('filechooser', SETTLE)
  await page.keyboard.press('Enter')
  await (
    await chooser
  ).setFiles({
    name: 'keyboard.html',
    mimeType: 'text/html',
    buffer: Buffer.from(html('Keyboard Talk').text),
  })

  await page.waitForURL(`${TEST_ORIGIN}/slides/keyboard-talk`, SETTLE)
  expect(await db.$count(decks)).toBe(1)
  await page.context().close()
})

test('F22-AC27: Given a signed-in author on the list of their slides, When they drop one HTML file there, Then the page of the new slide opens', async () => {
  const { page, errors, exchanges } = await openPage(browser, env, '/slides', {
    cookie,
  })
  await expect
    .poll(() => page.locator(`${ZONE} [data-drop-choose]`).isEnabled(), SETTLE)
    .toBe(true)

  await dropFiles(page, ZONE, [html('日本語の題名')])

  // The title spells no slug, so the file's name does.
  await page.waitForURL(`${TEST_ORIGIN}/slides/my-talk`, SETTLE)
  await expect
    .poll(() => page.locator('h1').textContent(), SETTLE)
    .toBe('日本語の題名')
  expect(failures(exchanges)).toEqual([])
  expect(errors.filter(notACover)).toEqual([])
  await page.context().close()
})

test('F22-AC7: Given an HTML file dropped in the browser, When the stored index.html is read, Then it loads the page script exactly once', async () => {
  const { page } = await openPage(browser, env, '/', { cookie })
  await expect
    .poll(() => page.locator(`${ZONE} [data-drop-choose]`).isEnabled(), SETTLE)
    .toBe(true)

  await dropFiles(page, ZONE, [html('Script Talk')])
  await page.waitForURL(`${TEST_ORIGIN}/slides/script-talk`, SETTLE)

  const [file] = await db.select().from(uploadFiles)
  const stored = await (await platform.env.UPLOADS.get(
    file!.object_key!,
  ))!.text()
  expect(file?.path).toBe('index.html')
  expect(stored.split('/_preview/pages.js').length - 1).toBe(1)
  expect(stored).toContain('<title>Script Talk</title>')
  await page.context().close()
})

test.each([
  [
    'a PDF',
    [{ name: 'talk.pdf', type: 'application/pdf', text: '%PDF-1.7' }],
    'HTML(.html)か zip のファイルを選んでください。',
  ],
  [
    'two files at once',
    [html('One'), { ...html('Two'), name: 'two.html' }],
    'HTML(.html)か zip のファイルを選んでください。',
  ],
])(
  'F22-AC6: Given %s is dropped, When the frame answers, Then the reason is shown in the frame and nothing is sent',
  async (_name, files, message) => {
    const { page, exchanges } = await openPage(browser, env, '/', { cookie })
    await expect
      .poll(
        () => page.locator(`${ZONE} [data-drop-choose]`).isEnabled(),
        SETTLE,
      )
      .toBe(true)

    await dropFiles(page, ZONE, files)

    const alert = page.locator(`${ZONE} [role="alert"]`)
    await expect.poll(() => alert.textContent(), SETTLE).toBe(message)
    expect(starts(exchanges)).toEqual([])
    expect(await db.$count(decks)).toBe(0)
    // The frame is ready for another file.
    expect(await page.locator(`${ZONE} [data-drop-choose]`).isEnabled()).toBe(
      true,
    )
    await page.context().close()
  },
)

test('F22-AC6: Given an HTML file larger than one file may be, When it is dropped, Then the frame names the limit for one file and nothing is sent', async () => {
  const { page, exchanges } = await openPage(browser, env, '/', { cookie })
  await expect
    .poll(() => page.locator(`${ZONE} [data-drop-choose]`).isEnabled(), SETTLE)
    .toBe(true)

  await dropFiles(page, ZONE, [
    {
      name: 'big.html',
      type: 'text/html',
      text: '<!doctype html>' + 'x'.repeat(VERSION_LIMITS.fileBytes),
    },
  ])

  await expect
    .poll(() => page.locator(`${ZONE} [role="alert"]`).textContent(), SETTLE)
    .toBe('big.html は 5.0 MB あります。1 つのファイルは 5.0 MB までです。')
  expect(starts(exchanges)).toEqual([])
  await page.context().close()
})

test('F22-AC6: Given the author has as many slides as allowed, When they drop another, Then the frame names the limit on slides', async () => {
  const limited = { ...env, UPLOAD_LIMITS: { decks: 1 } } as unknown as Env
  await db.insert(decks).values({
    id: 'only',
    slug: 'only',
    owner_user_id: '722500',
    created_at: 1,
  })
  const { page } = await openPage(browser, limited, '/', { cookie })
  await expect
    .poll(() => page.locator(`${ZONE} [data-drop-choose]`).isEnabled(), SETTLE)
    .toBe(true)

  await dropFiles(page, ZONE, [html('Second')])

  await expect
    .poll(() => page.locator(`${ZONE} [role="alert"]`).textContent(), SETTLE)
    .toContain('スライドの本数の上限')
  expect(await db.$count(decks)).toBe(1)
  await page.context().close()
})

test('F22-AC16: Given an author taken off the registration while signed in, When they drop a file, Then nothing is received and the frame says the service is by invitation', async () => {
  const removed = await signIn(env, 'bob', { id: INVITED_ID })
  // Only the first author is registered now.
  const { page } = await openPage(browser, testEnv(platform.env), '/', {
    cookie: removed,
  })
  await expect
    .poll(() => page.locator(`${ZONE} [data-drop-choose]`).isEnabled(), SETTLE)
    .toBe(true)

  await dropFiles(page, ZONE, [html('Not Invited')])

  await expect
    .poll(() => page.locator(`${ZONE} [role="alert"]`).textContent(), SETTLE)
    .toContain('招待制')
  expect(await db.$count(decks)).toBe(0)
  expect(await db.$count(deployments)).toBe(0)
  await page.context().close()
})

test('Given a file being received, When the frame is looked at, Then it says so, names the file, shows a progress bar, and takes no second file', async () => {
  const release = Promise.withResolvers<void>()
  const { page } = await openPage(browser, env, '/', {
    cookie,
    hold: (method) => (method === 'PUT' ? release.promise : undefined),
  })
  await expect
    .poll(() => page.locator(`${ZONE} [data-drop-choose]`).isEnabled(), SETTLE)
    .toBe(true)

  await dropFiles(page, ZONE, [html('Slow Talk')])

  const bar = page.locator(`${ZONE} [role="progressbar"]`)
  await expect.poll(() => bar.isVisible(), SETTLE).toBe(true)
  expect(await bar.getAttribute('aria-valuenow')).toBe('0')
  expect(await bar.getAttribute('aria-valuemax')).toBe('1')
  expect(await page.locator(`${ZONE} [data-drop-title]`).textContent()).toBe(
    '受け取っています',
  )
  expect(await page.locator(`${ZONE} [data-drop-note]`).textContent()).toBe(
    'My Talk.html',
  )
  expect(await page.locator(`${ZONE} [role="status"]`).textContent()).toBe(
    '終わると、このスライドの管理ページが開きます。',
  )
  await dropFiles(page, ZONE, [{ ...html('Second Talk'), name: 'second.html' }])
  release.resolve()

  await page.waitForURL(`${TEST_ORIGIN}/slides/slow-talk`, SETTLE)
  expect(await db.$count(decks)).toBe(1)
  await page.context().close()
})

test('Given a file held over the frame, When it is dragged in and out, Then the frame shows it would take the file only while it is over', async () => {
  const { page } = await openPage(browser, env, '/', { cookie })
  await expect
    .poll(() => page.locator(`${ZONE} [data-drop-choose]`).isEnabled(), SETTLE)
    .toBe(true)
  const transfer = await page.evaluateHandle(() => new DataTransfer())

  await page.dispatchEvent(ZONE, 'dragover', { dataTransfer: transfer })
  expect(await page.locator(ZONE).getAttribute('data-over')).toBe('')
  expect(
    await page
      .locator(ZONE)
      .evaluate((element) => getComputedStyle(element).borderTopStyle),
  ).toBe('solid')

  await page.dispatchEvent(ZONE, 'dragleave', { dataTransfer: transfer })
  expect(await page.locator(ZONE).getAttribute('data-over')).toBeNull()
  await page.context().close()
})

test('Given the page in English, When a file is refused, Then the reason is in English', async () => {
  const { page } = await openPage(browser, env, '/?lang=en', {
    cookie,
    lang: 'en-US',
  })
  await expect
    .poll(() => page.locator(`${ZONE} [data-drop-choose]`).isEnabled(), SETTLE)
    .toBe(true)

  await dropFiles(page, ZONE, [
    { name: 'talk.pdf', type: 'application/pdf', text: '%PDF' },
  ])

  await expect
    .poll(() => page.locator(`${ZONE} [role="alert"]`).textContent(), SETTLE)
    .toBe('Choose an HTML (.html) or a zip file.')
  await page.context().close()
})

test('F22-AC8: Given slides dropped without the page script that turn pages by `#3`, When they are published and a reader turns a page in the viewer, Then the page number in the address changes', async () => {
  const paged = {
    ...env,
    CONTENT_ORIGIN: 'https://content.example',
  } as unknown as Env
  const { page } = await openPage(browser, paged, '/', {
    cookie,
    contentHost: 'content.example',
  })
  await expect
    .poll(() => page.locator(`${ZONE} [data-drop-choose]`).isEnabled(), SETTLE)
    .toBe(true)
  await dropFiles(page, ZONE, [
    html(
      'Paged Talk',
      `<button id="third" onclick="location.hash = '#3'">3</button>`,
    ),
  ])
  await page.waitForURL(`${TEST_ORIGIN}/slides/paged-talk`, SETTLE)
  const [deck] = await db.select({ id: decks.id }).from(decks)
  const [version] = await db.select({ id: deployments.id }).from(deployments)
  expect(
    (
      await applyAuthorCommand(database, {
        ownerUserId: OWNER_ID,
        deckId: deck!.id,
        expectedRevision: 0,
        command: { kind: 'publish', deploymentId: version!.id },
        now: Math.floor(Date.now() / 1000),
      })
    ).kind,
  ).toBe('applied')

  await page.goto(`${TEST_ORIGIN}/@alice/paged-talk`)
  await page.frameLocator('iframe#deck').locator('#third').click(SETTLE)

  await expect
    .poll(() => new URL(page.url()).pathname, SETTLE)
    .toBe('/@alice/paged-talk/3')
  await page.context().close()
})
