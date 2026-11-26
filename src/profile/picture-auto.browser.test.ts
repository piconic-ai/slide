import { openTestBrowser } from '../test-open-browser'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { chromium, firefox, webkit, type Browser, type Page } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { PICTURE_MAX_BYTES } from './picture-policy'
import { cleanPicturePng } from './picture-png'
import {
  chunkTypes,
  png,
  squarePng,
  withExif,
  withPngText,
} from './test-picture'
import {
  OWNER_ID,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

/**
 * The browser engine, chosen with BROWSER (chromium, webkit or firefox). The
 * code job runs Chromium; CI runs the other two in jobs of their own, so the
 * shrinking is seen to work in Safari's engine as well.
 */
const engineName = process.env.BROWSER ?? 'chromium'
const engine = { chromium, webkit, firefox }[engineName]
if (!engine) throw new Error(`Unknown BROWSER: ${engineName}`)

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
let browser: Browser
let cookie = ''

beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  cookie = await signIn(env, 'owner', { name: 'Owner' })
  browser = await openTestBrowser(engine)
  await new Promise<void>((done) => http.listen(0, '127.0.0.1', done))
  const address = http.address()
  origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
})
afterAll(async () => {
  await browser?.close()
  await new Promise((done) => http.close(done))
  await platform.dispose()
})

const SETTLE = { timeout: 15000 }

/** The body of each upload the browser sent, since the page was opened. */
const uploads: Buffer[] = []

/**
 * The Worker, answering the browser over real HTTP on this machine. Requests
 * are not intercepted in the browser: WebKit leaves a chosen file out of an
 * intercepted request's body. Each request is passed on as one to the
 * service's own origin, carrying the owner's session.
 */
const http = createServer(async (incoming, outgoing) => {
  const chunks: Buffer[] = []
  for await (const chunk of incoming) chunks.push(chunk as Buffer)
  const body = Buffer.concat(chunks)
  const method = incoming.method ?? 'GET'
  const url = new URL(incoming.url ?? '/', TEST_ORIGIN)
  if (method === 'POST' && url.pathname === '/settings/picture')
    uploads.push(body)
  const headers = new Headers()
  for (const [name, value] of Object.entries(incoming.headers))
    if (typeof value === 'string' && name !== 'host') headers.set(name, value)
  headers.set('cookie', cookie)
  if (method === 'POST') {
    headers.set('origin', TEST_ORIGIN)
    headers.set('sec-fetch-site', 'same-origin')
  }
  const response = await server.fetch(
    new Request(url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      redirect: 'manual',
    }),
    env,
  )
  outgoing.writeHead(response.status, Object.fromEntries(response.headers))
  outgoing.end(Buffer.from(await response.arrayBuffer()))
})
let origin = ''

/** Opens settings with the Worker answering the browser. */
async function settingsPage({
  javaScript = true,
  init,
  httpCache = false,
}: { javaScript?: boolean; init?: string; httpCache?: boolean } = {}) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 800 },
    locale: 'ja-JP',
    javaScriptEnabled: javaScript,
  })
  if (init) await context.addInitScript(init)
  // Nothing outside this machine is reached. Routing turns the browser's
  // HTTP cache off, so a test of what the cache keeps only records them.
  const outside: string[] = []
  if (httpCache)
    context.on('request', (request) => {
      if (new URL(request.url()).origin !== origin) outside.push(request.url())
    })
  else
    await context.route(
      (url) => url.origin !== origin,
      (route) => route.abort(),
    )
  uploads.length = 0
  const page = await context.newPage()
  await page.goto(`${origin}/settings`)
  return { page, context, uploads, outside }
}

const stored = async () => {
  const object = await platform.env.UPLOADS.get(`avatars/${OWNER_ID}`)
  return object ? new Uint8Array(await object.arrayBuffer()) : null
}
const forget = () => platform.env.UPLOADS.delete(`avatars/${OWNER_ID}`)

const file = (data: Uint8Array | Buffer, name: string, mimeType: string) => ({
  name,
  mimeType,
  buffer: Buffer.from(data),
})
const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))
/**
 * 40 by 20: red on the left half, blue on the right. Made with ImageMagick:
 * `magick -size 20x20 xc:'#ff0000' xc:'#0000ff' +append -strip` and
 * `-quality 95 halves.jpg`, or `-define webp:lossless=true halves.webp`.
 */
const HALVES_JPEG = fixture('halves.jpg')
const HALVES_WEBP = fixture('halves.webp')
/**
 * 120 by 90, a photo with the EXIF a phone writes: the camera's make and
 * model, the lens, when it was taken, and where (35.681236 N, 139.767125 E).
 * Made with ImageMagick, `magick -seed 1 -size 120x90 plasma: -quality 85
 * -strip base.jpg`, and then written again by macOS ImageIO, as an iPhone
 * writes a photo: `CGImageDestinationAddImageFromSource` with the TIFF
 * dictionary `Make: Apple, Model: iPhone 15 Pro`, the Exif dictionary
 * `DateTimeOriginal: 2026:11:20 10:15:30, LensModel: iPhone 15 Pro back
 * camera 6.765mm f/1.78`, and the GPS dictionary `Latitude: 35.681236,
 * LatitudeRef: N, Longitude: 139.767125, LongitudeRef: E`. ImageIO stores the
 * place as degrees, minutes and seconds, big-endian rationals (`GPS_PLACE`).
 */
const PHONE_JPEG = fixture('phone.jpg')
const rational = (numerator: number, denominator: number) => {
  const bytes = Buffer.alloc(8)
  bytes.writeUInt32BE(numerator, 0)
  bytes.writeUInt32BE(denominator, 4)
  return bytes
}
/** What of the phone's EXIF names the photo, its place and its camera. */
const PHONE_METADATA: [string, Buffer][] = [
  [
    'the latitude',
    Buffer.concat([rational(35, 1), rational(40, 1), rational(5245, 100)]),
  ],
  [
    'the longitude',
    Buffer.concat([rational(139, 1), rational(46, 1), rational(165, 100)]),
  ],
  ['the model', Buffer.from('iPhone 15 Pro', 'latin1')],
  ['the make', Buffer.from('Apple', 'latin1')],
  ['the time taken', Buffer.from('2026:11:20 10:15:30', 'latin1')],
  ['the mark of EXIF', Buffer.from('Exif', 'latin1')],
]
/** The place as it was given, in text, as other metadata (XMP) writes it. */
const PHONE_PLACE_TEXT: [string, Buffer][] = [
  ['the latitude in degrees', Buffer.from('35.681236', 'latin1')],
  ['the longitude in degrees', Buffer.from('139.767125', 'latin1')],
]

const pick = (page: Page) => page.getByLabel('画像を選ぶ')
/** Waits until the script has made the field ready to choose a file. */
const ready = (page: Page) =>
  expect.poll(() => pick(page).isEnabled(), SETTLE).toBe(true)

/** The PNG inside a posted multipart body, from its signature to IEND. */
function postedPng(body: Buffer): Buffer {
  const start = body.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  const end = body.indexOf(Buffer.from('IEND', 'latin1'), start)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  return body.subarray(start, end + 8)
}
const sideOf = (picture: Uint8Array) => {
  const view = Buffer.from(picture)
  return [view.readUInt32BE(16), view.readUInt32BE(20)]
}

/** The colour at a few points of a PNG, read by the browser drawing it. */
const colours = (page: Page, picture: Uint8Array, points: number[][]) =>
  page.evaluate(
    async ({ bytes, points }) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
      )
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d')!
      context.drawImage(bitmap, 0, 0)
      return points.map(([x, y]) => {
        const [r, , b] = context.getImageData(x!, y!, 1, 1).data
        return r! > 180 && b! < 80 ? 'red' : b! > 180 && r! < 80 ? 'blue' : '?'
      })
    },
    { bytes: [...picture], points },
  )

/** Chooses a file and waits for the page that says the picture changed. */
async function chooseAndWait(page: Page, chosen: ReturnType<typeof file>) {
  await ready(page)
  await pick(page).setInputFiles(chosen)
  await expect
    .poll(() => page.url(), SETTLE)
    .toContain('/settings?saved=picture')
  await expect
    .poll(
      () => page.getByText('プロフィール画像を変えました。').isVisible(),
      SETTLE,
    )
    .toBe(true)
}

test.each([
  ['a PNG', () => file(png(300, 200), 'face.png', 'image/png')],
  ['a JPEG', () => file(HALVES_JPEG, 'face.jpg', 'image/jpeg')],
  ['a WebP', () => file(HALVES_WEBP, 'face.webp', 'image/webp')],
])(
  'F28-AC93 F28-AC41: Given scripts run, When %s is chosen, Then a 256 by 256 PNG of it is sent at once with no button pressed, it is stored, and the picture changes',
  async (_, chosen) => {
    await forget()
    const { page, context, uploads } = await settingsPage()
    try {
      await chooseAndWait(page, chosen())
      expect(uploads).toHaveLength(1)
      const sent = postedPng(uploads[0]!)
      expect(sideOf(sent)).toEqual([256, 256])
      expect(uploads[0]!.toString('latin1')).toContain(
        'Content-Type: image/png',
      )
      const kept = await stored()
      expect(kept).not.toBeNull()
      expect(sideOf(kept!)).toEqual([256, 256])
      expect(cleanPicturePng(kept!).kind).toBe('ok')
      const preview = page.locator('.settings-face img')
      expect(await preview.getAttribute('src')).toMatch(
        /\/avatars\/\w+\?v=u\d+$/,
      )
      await expect
        .poll(
          () =>
            preview.evaluate(
              (img: HTMLImageElement) => img.complete && img.naturalWidth,
            ),
          SETTLE,
        )
        .toBe(256)
    } finally {
      await context.close()
    }
  },
  45000,
)

test('F28-AC93: Given a browser without requestSubmit (Safari before 16), When a picture is chosen, Then the 256 by 256 PNG is still sent and stored', async () => {
  await forget()
  const { page, context, uploads } = await settingsPage({
    init: 'delete HTMLFormElement.prototype.requestSubmit',
  })
  try {
    await chooseAndWait(page, file(png(300, 200), 'face.png', 'image/png'))
    expect(uploads).toHaveLength(1)
    expect(sideOf(postedPng(uploads[0]!))).toEqual([256, 256])
    const kept = await stored()
    expect(kept).not.toBeNull()
    expect(sideOf(kept!)).toEqual([256, 256])
  } finally {
    await context.close()
  }
}, 45000)

test('F28-AC93: Given a wide picture, When it is chosen, Then its middle square is what is kept', async () => {
  await forget()
  const { page, context } = await settingsPage()
  try {
    // 40 by 20, red then blue: the middle 20 by 20 is half of each.
    await chooseAndWait(page, file(HALVES_WEBP, 'face.webp', 'image/webp'))
    expect(
      await colours(page, (await stored())!, [
        [40, 128],
        [216, 128],
      ]),
    ).toEqual(['red', 'blue'])
  } finally {
    await context.close()
  }
}, 45000)

test('F28-AC94: Given a JPEG whose EXIF says to turn it a quarter clockwise, When it is chosen, Then the picture kept stands the way the browser shows it', async () => {
  await forget()
  const { page, context } = await settingsPage()
  try {
    const turned = withExif(HALVES_JPEG, 6, 'slide-secret-place')
    await chooseAndWait(page, file(turned, 'turned.jpg', 'image/jpeg'))
    // Shown turned, the red half is on top and the blue half below.
    expect(
      await colours(page, (await stored())!, [
        [64, 40],
        [192, 40],
        [64, 216],
        [192, 216],
      ]),
    ).toEqual(['red', 'red', 'blue', 'blue'])
  } finally {
    await context.close()
  }
}, 45000)

test.each([
  [
    'a JPEG with EXIF',
    () =>
      file(
        withExif(HALVES_JPEG, 1, 'slide-secret-place'),
        'a.jpg',
        'image/jpeg',
      ),
  ],
  [
    'a PNG with a text chunk',
    () =>
      file(
        withPngText(png(64, 64), 'slide-secret-place'),
        'a.png',
        'image/png',
      ),
  ],
])(
  'F28-AC95: Given %s, When it is chosen, Then neither what is sent nor what is kept carries its metadata',
  async (_, chosen) => {
    await forget()
    const { page, context, uploads } = await settingsPage()
    try {
      await chooseAndWait(page, chosen())
      expect(uploads[0]!.toString('latin1')).not.toContain('slide-secret')
      const sent = postedPng(uploads[0]!)
      expect(chunkTypes(sent)).toEqual(
        expect.not.arrayContaining(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']),
      )
      const kept = (await stored())!
      expect(Buffer.from(kept).toString('latin1')).not.toContain('slide-secret')
      expect(chunkTypes(kept)).toEqual(
        expect.not.arrayContaining(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']),
      )
    } finally {
      await context.close()
    }
  },
  45000,
)

test('F28-AC95: Given a phone photo whose EXIF holds where it was taken and the camera, When it is chosen, Then neither what is sent nor what is kept holds the latitude, the longitude, the model or the mark of EXIF', async () => {
  // The photo holds each of them, as a phone writes it.
  for (const [name, bytes] of PHONE_METADATA)
    expect(Buffer.from(PHONE_JPEG).indexOf(bytes), name).toBeGreaterThan(0)
  await forget()
  const { page, context, uploads } = await settingsPage()
  try {
    await chooseAndWait(page, file(PHONE_JPEG, 'IMG_0001.JPG', 'image/jpeg'))
    expect(uploads).toHaveLength(1)
    const kept = Buffer.from((await stored())!)
    expect(sideOf(kept)).toEqual([256, 256])
    for (const [name, bytes] of [...PHONE_METADATA, ...PHONE_PLACE_TEXT]) {
      expect(uploads[0]!.indexOf(bytes), `sent: ${name}`).toBe(-1)
      expect(kept.indexOf(bytes), `kept: ${name}`).toBe(-1)
    }
    expect(chunkTypes(kept)).toEqual(
      expect.not.arrayContaining(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']),
    )
  } finally {
    await context.close()
  }
}, 45000)

test('F28-AC96: Given scripts run, When a GIF, a file over 1 MB, an unreadable PNG and a picture over 8192 pixels wide are chosen in turn, Then none is sent, each reason shows under the field, and the field is cleared', async () => {
  await forget()
  const { page, context, uploads } = await settingsPage()
  try {
    await ready(page)
    const notice = page.locator('#picture-client-error')
    const refusals: [ReturnType<typeof file>, string][] = [
      [
        file(Buffer.from('GIF89a......'), 'x.gif', 'image/gif'),
        'PNG、JPEG、WebP の画像だけ使えます。',
      ],
      [
        file(new Uint8Array(PICTURE_MAX_BYTES + 1), 'big.png', 'image/png'),
        '画像は 1 MB までです。',
      ],
      [
        file(squarePng().subarray(0, 40), 'broken.png', 'image/png'),
        '画像として読めませんでした。',
      ],
      [
        file(png(8193, 1), 'wide.png', 'image/png'),
        '画像の縦か横が長すぎます(8192 ピクセルまで)。',
      ],
    ]
    for (const [chosen, reason] of refusals) {
      await pick(page).setInputFiles(chosen)
      await expect.poll(() => notice.textContent(), SETTLE).toContain(reason)
      expect(await notice.isVisible()).toBe(true)
      await expect.poll(() => pick(page).inputValue(), SETTLE).toBe('')
    }
    expect(uploads).toHaveLength(0)
    expect(await stored()).toBeNull()
    // A good file after the refused ones clears the reason and goes.
    await pick(page).setInputFiles(file(png(20, 20), 'ok.png', 'image/png'))
    await expect.poll(() => page.url(), SETTLE).toContain('saved=picture')
    expect(uploads).toHaveLength(1)
  } finally {
    await context.close()
  }
}, 45000)

test('F28-AC87: Given a file was just chosen, When another is chosen before the page answers, Then only one upload is sent', async () => {
  const { page, context, uploads } = await settingsPage()
  try {
    await ready(page)
    await pick(page).evaluate(
      (el: HTMLInputElement, bytes: number[]) => {
        const make = (name: string) => {
          const data = new DataTransfer()
          data.items.add(
            new File([new Uint8Array(bytes)], name, { type: 'image/png' }),
          )
          el.files = data.files
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
        make('a.png')
        make('b.png')
      },
      [...png(30, 30)],
    )
    await expect.poll(() => uploads.length, SETTLE).toBeGreaterThan(0)
    await page.waitForLoadState('load')
    expect(uploads).toHaveLength(1)
  } finally {
    await context.close()
  }
}, 45000)

test('F28-AC99: Given scripts do not run, When settings are opened, Then the reason shows, the file field cannot be used, and there is no button that sends a file', async () => {
  const { page, context } = await settingsPage({ javaScript: false })
  try {
    const reason = page.locator('#picture-no-script')
    await expect.poll(() => reason.isVisible(), SETTLE).toBe(true)
    expect(await pick(page).isDisabled()).toBe(true)
    expect(
      await page.getByRole('button', { name: '画像をアップロード' }).count(),
    ).toBe(0)
    const pill = page.locator('label.picture-pick')
    expect(await pill.textContent()).toContain('画像を選ぶ')
    const box = await pill.boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(44)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(375)
  } finally {
    await context.close()
  }
}, 30000)

test('F28-AC99: Given a browser that cannot shrink pictures, When settings are opened, Then the reason shows and the file field stays disabled', async () => {
  const { page, context, uploads } = await settingsPage({
    init: 'delete window.createImageBitmap',
  })
  try {
    const notice = page.locator('#picture-client-error')
    await expect.poll(() => notice.isVisible(), SETTLE).toBe(true)
    expect(await notice.textContent()).toContain(
      'このブラウザでは画像を縮められないため',
    )
    expect(await pick(page).isDisabled()).toBe(true)
    // Scripts run, so the reason meant for no scripts does not show.
    expect(await page.locator('#picture-no-script').isVisible()).toBe(false)
    expect(uploads).toHaveLength(0)
  } finally {
    await context.close()
  }
}, 30000)

/**
 * The colour an image on the page shows at one point of its 256 by 256
 * picture, read by drawing it, once it has loaded; null while it has not.
 */
const shownColour = (page: Page, selector: string, [x, y]: number[]) =>
  page.evaluate(
    ({ selector, x, y }) => {
      const image = document.querySelector(selector)
      if (!(image instanceof HTMLImageElement)) return null
      if (!image.complete || image.naturalWidth === 0) return null
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      const [r, g, b] = context.getImageData(x!, y!, 1, 1).data
      if (r! > 180 && b! < 80) return 'red'
      if (b! > 180 && r! < 80) return 'blue'
      return Math.abs(r! - g!) < 16 && Math.abs(g! - b!) < 16 ? 'grey' : '?'
    },
    { selector, x, y },
  )
const HEADER_FACE = '[data-account] summary.avatar img'

test('F28-AC101: Given a picture shown in the header, When another picture is chosen, Then the header shows it under a new address at once, and so does the profile the header menu moves to', async () => {
  await forget()
  const { page, context, outside } = await settingsPage({ httpCache: true })
  try {
    await chooseAndWait(page, file(png(300, 200), 'grey.png', 'image/png'))
    await expect
      .poll(() => shownColour(page, HEADER_FACE, [128, 128]), SETTLE)
      .toBe('grey')
    const before = await page.locator(HEADER_FACE).getAttribute('src')
    // The middle square of the halves: red on the left, blue on the right.
    await chooseAndWait(page, file(HALVES_JPEG, 'halves.jpg', 'image/jpeg'))
    await expect
      .poll(() => page.locator(HEADER_FACE).getAttribute('src'), SETTLE)
      .not.toBe(before)
    await expect
      .poll(() => shownColour(page, HEADER_FACE, [40, 128]), SETTLE)
      .toBe('red')
    // The profile, reached from the header's menu without loading the page:
    // the router moves it in, and the header drawn before stays. Settings
    // run under a policy of their own, so the move starts from the slides.
    await page.goto(`${origin}/my/slides`)
    await expect
      .poll(() => shownColour(page, HEADER_FACE, [40, 128]), SETTLE)
      .toBe('red')
    await page.evaluate(() => Object.assign(window, { stayed: true }))
    await page.locator('[data-account] summary.avatar').click()
    await page.getByRole('link', { name: 'プロフィール' }).click()
    await expect.poll(() => page.url(), SETTLE).toContain('/@owner')
    expect(await page.evaluate(() => 'stayed' in window)).toBe(true)
    await expect
      .poll(() => shownColour(page, 'img.portrait-image', [40, 128]), SETTLE)
      .toBe('red')
    await expect
      .poll(() => shownColour(page, HEADER_FACE, [40, 128]), SETTLE)
      .toBe('red')
    expect(outside).toEqual([])
  } finally {
    await context.close()
  }
}, 45000)

/** The row's three parts and the notice under it, as boxes on the page. */
const rowBoxes = (page: Page) =>
  page.evaluate(() => {
    const box = (selector: string) => {
      const { left, right, top, bottom, height } = document
        .querySelector(selector)!
        .getBoundingClientRect()
      return { left, right, top, bottom, height, middle: (top + bottom) / 2 }
    }
    return {
      face: box('.picture-row .settings-face'),
      pick: box('.picture-row .picture-pick'),
      remove: box('.picture-row button[form="picture-remove"]'),
      row: box('.picture-row'),
      notice: box('.picture-row + .notice-success'),
    }
  })

test('F28-AC90: Given an uploaded profile picture and the notice under it, When the row is laid out, Then the picture and the buttons on one line share one centre line, the buttons beside each other are one height, and the notice stands 16px from the row', async () => {
  await forget()
  const { page, context } = await settingsPage()
  try {
    await chooseAndWait(page, file(png(300, 200), 'face.png', 'image/png'))
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 })
      const { face, pick: choose, remove, row, notice } = await rowBoxes(page)
      // On a phone the parts may wrap onto a second line; compare the ones
      // that share a line.
      const sameLine = (a: { top: number }, b: { top: number }) =>
        Math.abs(a.top - b.top) < 60
      if (sameLine(face, choose))
        expect(Math.abs(face.middle - choose.middle)).toBeLessThanOrEqual(1)
      if (sameLine(choose, remove))
        expect(Math.abs(choose.middle - remove.middle)).toBeLessThanOrEqual(1)
      // A long label may take two lines when the button wraps onto a line of
      // its own on a phone; beside the other button the two are one height.
      if (sameLine(choose, remove))
        expect(Math.abs(choose.height - remove.height)).toBeLessThanOrEqual(1)
      expect(choose.height).toBeGreaterThanOrEqual(44)
      expect(Math.abs(notice.top - row.bottom - 16)).toBeLessThanOrEqual(1)
    }
  } finally {
    await context.close()
  }
}, 45000)
