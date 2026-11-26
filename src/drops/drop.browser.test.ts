import { openTestBrowser } from '../test-open-browser'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import type { Browser } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { accounts, decks, deployments, uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { applyAuthorCommand } from '../publication/author'
import {
  INVITED_ID,
  keepInvited,
  OWNER_ID,
  resetTables,
  seedDeck,
  seedDeployment,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'
import {
  dropFiles,
  expectUploadFailure,
  openPage,
  type Exchange,
} from './test-browser'
import { makeZip, type ZipFixtureEntry } from './test-zip'

// The pages load /drop.js and /drop-core.js from `pnpm build`; CI builds
// before testing.
const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = withInvited(testEnv(platform.env))
let browser: Browser
let cookie = ''

// Other browser tests run at the same time, and a drop is several round
// trips, so each wait and each test gets longer than the default.
const SETTLE = { timeout: 60000 }
vi.setConfig({ testTimeout: 120000, hookTimeout: 60000 })
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
  browser = await openTestBrowser()
})
beforeEach(async () => {
  await resetTables(database)
  cookie = await signIn(env, 'alice')
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

test('F22-AC33, F22-AC47: Given a signed-in author on the top page, When they drop one HTML file, Then its private slide opens and index.html keeps the original bytes', async () => {
  const { page, errors, exchanges } = await openPage(browser, env, '/', {
    cookie,
  })
  await expect
    .poll(() => page.locator(`${ZONE} [data-drop-choose]`).isEnabled(), SETTLE)
    .toBe(true)

  const dropped = html('Drop Talk', '<h1>日本語</h1>\r\n')
  await dropFiles(page, ZONE, [dropped])

  await page.waitForURL(`${TEST_ORIGIN}/@alice/drop-talk`, SETTLE)
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
  const file = await db.select().from(uploadFiles).get()
  expect(file?.path).toBe('index.html')
  const stored = await platform.env.UPLOADS.get(file!.object_key!)
  expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(
    new TextEncoder().encode(dropped.text),
  )
  expect(failures(exchanges)).toEqual([])
  expect(errors.filter(notACover)).toEqual([])
  await page.context().close()
})

test('F22-AC2: Given a signed-in author using only the keyboard, When they reach "Choose a file" with Tab, press Enter and pick a file, Then the same happens as with a drop', async () => {
  const { page } = await openPage(browser, env, '/', { cookie })
  // Listening from the start has the browser hand file choosers to the test
  // before any key is pressed; turned on only at the press, the first
  // chooser of a page was sometimes missed on a busy machine.
  page.on('filechooser', () => {})
  const choose = page.locator(`${ZONE} [data-drop-choose]`)
  await expect.poll(() => choose.isEnabled(), SETTLE).toBe(true)
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

  await page.waitForURL(`${TEST_ORIGIN}/@alice/keyboard-talk`, SETTLE)
  expect(await db.$count(decks)).toBe(1)
  await page.context().close()
})

test('F22-AC36: Given a signed-in author on the list of their slides, When they drop one HTML file there, Then the page of the new slide opens', async () => {
  const { page, errors, exchanges } = await openPage(
    browser,
    env,
    '/my/slides',
    {
      cookie,
    },
  )
  await expect
    .poll(() => page.locator(`${ZONE} [data-drop-choose]`).isEnabled(), SETTLE)
    .toBe(true)

  await dropFiles(page, ZONE, [html('日本語の題名')])

  // The title spells no slug, so the file's name does.
  await page.waitForURL(`${TEST_ORIGIN}/@alice/my-talk`, SETTLE)
  await expect
    .poll(() => page.locator('h1').textContent(), SETTLE)
    .toBe('日本語の題名')
  expect(failures(exchanges)).toEqual([])
  expect(errors.filter(notACover)).toEqual([])
  await page.context().close()
})

test('F22-AC6: Given the author has as many slides as allowed, When they drop another, Then the frame names the limit on slides', async () => {
  const limited = { ...env, UPLOAD_LIMITS: { decks: 1 } } as unknown as Env
  // A slide counts once it holds a version.
  await seedDeck(database, 'only')
  await seedDeployment(database, 'only')
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

test('F22-AC38: Given an author taken off the registration while signed in, When they drop a file on the top page, Then nothing is sent or received: the service no longer knows them, so the file waits for a sign-in, which tells them it is by invitation', async () => {
  const removed = await signIn(env, 'bob', { id: INVITED_ID })
  // Bob is taken off the invitations now.
  await keepInvited(platform.env.DB, [OWNER_ID])
  const onlyFirst = testEnv(platform.env)
  const { page, exchanges } = await openPage(browser, onlyFirst, '/', {
    cookie: removed,
  })
  await expect
    .poll(() => page.locator(`${ZONE} [data-drop-choose]`).isEnabled(), SETTLE)
    .toBe(true)

  await dropFiles(page, ZONE, [html('Not Invited')])

  await expect
    .poll(() => page.locator(ZONE).getAttribute('data-picked'), SETTLE)
    .toBe('')
  expect(starts(exchanges)).toEqual([])
  expect(await db.$count(decks)).toBe(0)
  expect(await db.$count(deployments)).toBe(0)
  // The way on is the sign-in, which refuses them and says why.
  expect(
    await page
      .locator(ZONE)
      .getByRole('link', { name: 'ログインして続ける' })
      .getAttribute('href'),
  ).toMatch(/^\/login\?to=top&drop=[0-9a-f-]{36}$/)
  expect(
    await signIn(onlyFirst, 'bob', { id: INVITED_ID, invited: false }),
  ).toBe('')
  const told = await server.fetch(
    new Request(`${TEST_ORIGIN}/login`),
    onlyFirst,
  )
  expect(await told.text()).toContain('招待制')
  await page.context().close()
})

test('F22-AC38: Given an author taken off the registration while the list of their slides is open, When they drop a file there, Then nothing is received and the frame says the service is by invitation', async () => {
  const session = await signIn(env, 'bob', { id: INVITED_ID })
  let removed: Env | undefined
  const { page } = await openPage(browser, env, '/my/slides', {
    cookie: session,
    envNow: () => removed,
  })
  await expect
    .poll(() => page.locator(`${ZONE} [data-drop-choose]`).isEnabled(), SETTLE)
    .toBe(true)
  // Taken off the invitations after the page was drawn.
  await keepInvited(platform.env.DB, [OWNER_ID])
  removed = testEnv(platform.env)

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
  expect(await page.locator(`${ZONE} [data-drop-choose]`).isVisible()).toBe(
    false,
  )
  expect(await page.locator(`${ZONE} [role="status"]`).textContent()).toBe(
    '終わると、このスライドを確かめる画面が開きます。',
  )
  await dropFiles(page, ZONE, [{ ...html('Second Talk'), name: 'second.html' }])
  release.resolve()

  await page.waitForURL(`${TEST_ORIGIN}/@alice/slow-talk`, SETTLE)
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
  const { page, exchanges } = await openPage(browser, env, '/?lang=en', {
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
  expect(starts(exchanges)).toEqual([])
  expect(await db.$count(decks)).toBe(0)
  expect(await page.locator(`${ZONE} [data-drop-choose]`).isEnabled()).toBe(
    true,
  )
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
  await page.waitForURL(`${TEST_ORIGIN}/@alice/paged-talk`, SETTLE)
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

// A 1×1 PNG, so the browser can tell a picture that loaded from one that
// did not.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const zipPage = `<!doctype html><html><head><title>Zip Talk</title>
  <link rel="stylesheet" href="css/site.css"></head>
  <body><h1 id="title">Zipped</h1><img id="photo" src="img/photo.png"></body></html>`
const zipFile = (
  entries: readonly ZipFixtureEntry[],
  name = 'zip-talk.zip',
) => ({
  name,
  type: 'application/zip',
  bytes: makeZip(entries),
})
const withContent = {
  ...env,
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

/** Publishes the only slide, as the author would from its page. */
async function publishOnlySlide() {
  const [deck] = await db.select({ id: decks.id }).from(decks)
  const [version] = await db.select({ id: deployments.id }).from(deployments)
  const result = await applyAuthorCommand(database, {
    ownerUserId: OWNER_ID,
    deckId: deck!.id,
    expectedRevision: 0,
    command: { kind: 'publish', deploymentId: version!.id },
    now: Math.floor(Date.now() / 1000),
  })
  expect(result.kind).toBe('applied')
}

test.each([
  [
    'F22-AC3, F22-AC5',
    'with index.html, a stylesheet, a picture and their AppleDouble files at its top',
    [
      { name: 'index.html', data: zipPage },
      { name: 'css/site.css', data: 'h1 { color: rgb(1, 2, 3); }' },
      { name: 'img/photo.png', data: PNG, method: 0 },
      { name: '._index.html', data: 'fork' },
      { name: 'img/._photo.png', data: 'fork' },
    ],
  ],
  [
    'F22-AC4',
    'whose files are all inside one folder, as macOS packs it',
    [
      { name: 'zip-talk/', data: '' },
      { name: 'zip-talk/index.html', data: zipPage },
      { name: 'zip-talk/css/site.css', data: 'h1 { color: rgb(1, 2, 3); }' },
      { name: 'zip-talk/img/photo.png', data: PNG, method: 0 },
      { name: 'zip-talk/.DS_Store', data: 'finder' },
      { name: '__MACOSX/zip-talk/._index.html', data: 'fork' },
    ],
  ],
] as const)(
  '%s: Given a signed-in author, When they drop a zip %s, Then the slide’s page opens, and the slide shows index.html with its stylesheet and picture loaded',
  async (_id, _name, entries) => {
    const { page } = await openPage(browser, withContent, '/', {
      cookie,
      contentHost: 'content.example',
    })
    await expect
      .poll(
        () => page.locator(`${ZONE} [data-drop-choose]`).isEnabled(),
        SETTLE,
      )
      .toBe(true)

    await dropFiles(page, ZONE, [zipFile(entries)])

    await page.waitForURL(`${TEST_ORIGIN}/@alice/zip-talk`, SETTLE)
    expect(
      (await db.select({ path: uploadFiles.path }).from(uploadFiles))
        .map(({ path }) => path)
        .sort(),
    ).toEqual(['css/site.css', 'img/photo.png', 'index.html'])
    await publishOnlySlide()
    await page.goto(`${TEST_ORIGIN}/@alice/zip-talk`)
    const frame = page.frameLocator('iframe#deck')
    await expect
      .poll(() => frame.locator('#title').textContent(), SETTLE)
      .toBe('Zipped')
    await expect
      .poll(
        () =>
          frame
            .locator('#title')
            .evaluate((element) => getComputedStyle(element).color),
        SETTLE,
      )
      .toBe('rgb(1, 2, 3)')
    await expect
      .poll(
        () =>
          frame
            .locator('#photo')
            .evaluate((element) => (element as HTMLImageElement).naturalWidth),
        SETTLE,
      )
      .toBe(1)
    await page.context().close()
  },
)

test('F22-AC36: Given a signed-in author on the list of their slides, When they drop a zip there, Then the page of the new slide opens', async () => {
  const { page } = await openPage(browser, env, '/my/slides', { cookie })
  await expect
    .poll(() => page.locator(`${ZONE} [data-drop-choose]`).isEnabled(), SETTLE)
    .toBe(true)

  await dropFiles(page, ZONE, [
    zipFile([{ name: 'index.html', data: zipPage }], 'From The List.zip'),
  ])

  await page.waitForURL(`${TEST_ORIGIN}/@alice/zip-talk`, SETTLE)
  await expect
    .poll(() => page.locator('h1').textContent(), SETTLE)
    .toBe('Zip Talk')
  await page.context().close()
})

test('Given a drop whose upload did not finish, When the author drops the same file again as the frame asks, Then the same upload is finished: one slide, of the name itself', async () => {
  let down = true
  const { page, exchanges } = await openPage(browser, env, '/', {
    cookie,
    controlTime: true,
    down: (method) => method === 'PUT' && down,
  })
  await expect
    .poll(() => page.locator(`${ZONE} [data-drop-choose]`).isEnabled(), SETTLE)
    .toBe(true)
  await dropFiles(page, ZONE, [html('Retry Talk')])
  await expectUploadFailure(page, exchanges)
  const [first] = await db.select({ id: deployments.id }).from(deployments)

  down = false
  await dropFiles(page, ZONE, [html('Retry Talk')])

  await page.waitForURL(`${TEST_ORIGIN}/@alice/retry-talk`, SETTLE)
  expect(
    await db
      .select({ id: deployments.id, state: deployments.state })
      .from(deployments),
  ).toEqual([{ id: first!.id, state: 'ready' }])
  expect(await db.select({ slug: decks.slug }).from(decks)).toEqual([
    { slug: 'retry-talk' },
  ])
  await page.context().close()
})

test('Given a file being received, When several files are dropped on the frame, Then the frame keeps showing the upload and says nothing else', async () => {
  const release = Promise.withResolvers<void>()
  const { page } = await openPage(browser, env, '/', {
    cookie,
    hold: (method) => (method === 'PUT' ? release.promise : undefined),
  })
  await expect
    .poll(() => page.locator(`${ZONE} [data-drop-choose]`).isEnabled(), SETTLE)
    .toBe(true)
  await dropFiles(page, ZONE, [html('Busy Talk')])
  await expect
    .poll(
      () => page.locator(`${ZONE} [role="progressbar"]`).isVisible(),
      SETTLE,
    )
    .toBe(true)

  await dropFiles(page, ZONE, [
    { ...html('Two'), name: 'two.html' },
    { ...html('Three'), name: 'three.html' },
  ])

  expect(await page.locator(ZONE).getAttribute('data-busy')).toBe('')
  expect(await page.locator(`${ZONE} [data-drop-title]`).textContent()).toBe(
    '受け取っています',
  )
  expect(await page.locator(`${ZONE} [role="progressbar"]`).isVisible()).toBe(
    true,
  )
  expect(await page.locator(`${ZONE} [role="alert"]`).count()).toBe(0)
  expect(await page.locator(`${ZONE} [data-drop-choose]`).isVisible()).toBe(
    false,
  )
  release.resolve()
  await page.waitForURL(`${TEST_ORIGIN}/@alice/busy-talk`, SETTLE)
  expect(await db.$count(decks)).toBe(1)
  await page.context().close()
})

test('F22-AC2: Given someone using only the keyboard, When the file they chose is refused, Then focus is back on "Choose a file", and while a file is received it stays inside the frame', async () => {
  const release = Promise.withResolvers<void>()
  const { page } = await openPage(browser, env, '/', {
    cookie,
    hold: (method) => (method === 'PUT' ? release.promise : undefined),
  })
  // Listening from the start has the browser hand file choosers to the test
  // before any key is pressed; turned on only at the press, the first
  // chooser of a page was sometimes missed on a busy machine.
  page.on('filechooser', () => {})
  const choose = page.locator(`${ZONE} [data-drop-choose]`)
  await expect.poll(() => choose.isEnabled(), SETTLE).toBe(true)
  const focusIsOn = () =>
    page.evaluate(() => {
      const active = document.activeElement
      if (active?.hasAttribute('data-drop-choose')) return 'choose'
      return active?.closest('[data-drop-zone]') ? 'frame' : 'elsewhere'
    })

  // Enter on the button, then a file the frame refuses.
  await choose.focus()
  const refused = page.waitForEvent('filechooser', SETTLE)
  await page.keyboard.press('Enter')
  await (
    await refused
  ).setFiles({
    name: 'talk.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF'),
  })
  await expect
    .poll(() => page.locator(`${ZONE} [role="alert"]`).count(), SETTLE)
    .toBe(1)
  expect(await focusIsOn()).toBe('choose')

  // Enter again chooses another file without leaving the frame.
  const taken = page.waitForEvent('filechooser', SETTLE)
  await page.keyboard.press('Enter')
  await (
    await taken
  ).setFiles({
    name: 'talk.html',
    mimeType: 'text/html',
    buffer: Buffer.from(html('Focus Talk').text),
  })
  await expect
    .poll(
      () => page.locator(`${ZONE} [role="progressbar"]`).isVisible(),
      SETTLE,
    )
    .toBe(true)
  expect(await focusIsOn()).toBe('frame')
  release.resolve()
  await page.waitForURL(`${TEST_ORIGIN}/@alice/focus-talk`, SETTLE)
  await page.context().close()
})

test('F22-AC6: Given two files dropped at once, When the author retries with a zip containing a refused name, Then the alert changes to name that file and nothing is sent', async () => {
  const { page, exchanges } = await openPage(browser, env, '/', { cookie })
  await expect
    .poll(() => page.locator(`${ZONE} [data-drop-choose]`).isEnabled(), SETTLE)
    .toBe(true)

  await dropFiles(page, ZONE, [
    html('One'),
    { ...html('Two'), name: 'two.html' },
  ])
  const alert = page.locator(`${ZONE} [role="alert"]`)
  await expect
    .poll(() => alert.textContent(), SETTLE)
    .toBe('HTML(.html)か zip のファイルを選んでください。')
  expect(await page.locator(`${ZONE} [data-drop-choose]`).isEnabled()).toBe(
    true,
  )

  await dropFiles(page, ZONE, [
    zipFile([
      { name: 'index.html', data: zipPage },
      { name: 'img/100%.png', data: PNG, method: 0 },
    ]),
  ])

  await expect
    .poll(() => alert.textContent(), SETTLE)
    .toContain('img/100%.png は、名前に使えない文字を含むため受け取れません。')
  expect(starts(exchanges)).toEqual([])
  expect(await db.$count(decks)).toBe(0)
  await page.context().close()
})

const REPLACE = '[data-drop-zone="replace"]'
const viewerBody = (page: import('playwright').Page) =>
  page.frameLocator('iframe#deck').locator('#body').textContent(SETTLE)

test('F22-AC15: Given public slides, When the author drops a new version on their page, Then readers still get the earlier version at the share URL, and get the new one at the same URL once the author publishes it', async () => {
  const { page } = await openPage(browser, withContent, '/', {
    cookie,
    contentHost: 'content.example',
  })
  await expect
    .poll(() => page.locator(`${ZONE} [data-drop-choose]`).isEnabled(), SETTLE)
    .toBe(true)
  await dropFiles(page, ZONE, [
    html('Replace Talk', '<p id="body">first version</p>'),
  ])
  await page.waitForURL(`${TEST_ORIGIN}/@alice/replace-talk`, SETTLE)
  await publishOnlySlide()
  await page.goto(`${TEST_ORIGIN}/my/slides/replace-talk`)
  await expect
    .poll(
      () => page.locator(`${REPLACE} [data-drop-choose]`).isEnabled(),
      SETTLE,
    )
    .toBe(true)
  expect(await page.locator(REPLACE).getAttribute('data-deck')).toBe(
    'replace-talk',
  )

  // The version list orders ready timestamps to the nearest second.
  const first = await db
    .select({ readyAt: deployments.ready_at })
    .from(deployments)
    .get()
  await expect
    .poll(() => Math.floor(Date.now() / 1000), SETTLE)
    .toBeGreaterThan(first!.readyAt!)

  // When a new version is dropped on the slide's own page
  await dropFiles(page, REPLACE, [
    html('Replace Talk', '<p id="body">second version</p>'),
  ])
  await expect
    .poll(
      () =>
        db
          .select({ state: deployments.state })
          .from(deployments)
          .then((rows) => rows.map(({ state }) => state)),
      SETTLE,
    )
    .toEqual(['ready', 'ready'])

  // Then the page opens again with the version not published yet, not the viewer
  await expect
    .poll(() => page.locator('body').textContent(), SETTLE)
    .toContain('まだ公開していない新しい版')
  expect(page.url()).toBe(`${TEST_ORIGIN}/my/slides/replace-talk`)

  // And it is a version of the same slides, and readers see no change
  expect(await db.$count(decks)).toBe(1)
  const versions = await db
    .select({ id: deployments.id })
    .from(deployments)
    .orderBy(deployments.created_at, deployments.ready_at)
  const [deck] = await db
    .select({ public: decks.public_deployment_id, revision: decks.revision })
    .from(decks)
  const newer = versions.find(({ id }) => id !== deck!.public)
  expect(newer).toBeDefined()
  await page.goto(`${TEST_ORIGIN}/@alice/replace-talk`)
  expect(await viewerBody(page)).toBe('first version')

  // And once the author publishes the new version, the same URL shows it
  const published = await server.fetch(
    new Request(`${TEST_ORIGIN}/my/slides/replace-talk/publication`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        action: 'publish',
        deploymentId: newer!.id,
        expectedRevision: String(deck!.revision),
      }).toString(),
    }),
    withContent,
  )
  expect(published.headers.get('location')).toBe(
    '/my/slides/replace-talk?result=applied',
  )
  await page.goto(`${TEST_ORIGIN}/@alice/replace-talk`)
  expect(await viewerBody(page)).toBe('second version')
  await page.context().close()
})

test('F22-AC15: Given the page of slides, When a file that is not taken is dropped on the replace frame, Then the reason shows there and no version is added', async () => {
  await db.insert(decks).values({
    id: 'key-talk',
    slug: 'talk',
    owner_user_id: OWNER_ID,
    created_at: 1,
  })
  const { page, exchanges } = await openPage(browser, env, '/my/slides/talk', {
    cookie,
  })
  await expect
    .poll(
      () => page.locator(`${REPLACE} [data-drop-choose]`).isEnabled(),
      SETTLE,
    )
    .toBe(true)

  await dropFiles(page, REPLACE, [
    { name: 'talk.pdf', type: 'application/pdf', text: '%PDF' },
  ])

  await expect
    .poll(() => page.locator(`${REPLACE} [role="alert"]`).textContent(), SETTLE)
    .toBe('HTML(.html)か zip のファイルを選んでください。')
  expect(starts(exchanges)).toEqual([])
  expect(await db.$count(deployments)).toBe(0)
  await page.context().close()
})

test('F22-AC14: Given slides that were never published, When the author opens the URL name field, Then it rejects an invalid name, accepts a valid one and offers a 44px submit button', async () => {
  await db.insert(decks).values({
    id: 'key-talk',
    slug: 'talk',
    owner_user_id: OWNER_ID,
    created_at: 1,
  })
  const { page } = await openPage(browser, env, '/my/slides/talk', { cookie })
  const form = page.locator('form[data-url-name-form]')
  const input = form.getByLabel('URL', { exact: true })
  // The field is behind "URL を変える" and opens on a press.
  expect(await input.isVisible()).toBe(false)
  await page.getByText('URL を変える').click()
  expect(await input.isVisible()).toBe(true)

  // The input refuses, before sending, what could not be a name.
  await input.fill('Not A Name')
  expect(
    await input.evaluate((element) =>
      (element as HTMLInputElement).checkValidity(),
    ),
  ).toBe(false)
  await input.fill('kaigi-2026')
  expect(
    await input.evaluate((element) =>
      (element as HTMLInputElement).checkValidity(),
    ),
  ).toBe(true)
  expect(
    (await form.getByRole('button', { name: '変更する' }).boundingBox())
      ?.height,
  ).toBeGreaterThanOrEqual(44)
  await page.context().close()
})
