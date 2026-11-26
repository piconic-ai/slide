import { afterAll, beforeAll, expect, test } from 'vitest'
import { drizzle } from 'drizzle-orm/d1'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  seedDeck,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env
let id = ''

beforeAll(async () => {
  await applyMigrations(db)
  await signIn(env)
  id = await seedPublic(db, 'talk', 1, '<Talk> & "friends"')
  await drizzle(db)
    .insert(uploadFiles)
    .values({
      deployment_id: id,
      id: '0',
      path: 'index.html',
      size: 1,
      sha256: 'a'.repeat(64),
      media_type: 'text/html',
      object_key: `${id}/0`,
    })
  await seedDeck(db, 'draft')
})
afterAll(() => platform.dispose())

const get = (path: string, headers: HeadersInit = {}) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`, { headers }), env)

test('F37-AC2, AC15: Given a public deck, When its viewer is opened, Then an empty live region and the band it is filled with sit above the slides, and the shell is carried for the viewer to keep', async () => {
  const page = await (await get('/@owner/talk')).text()
  const stage = /<div class="stage">([\s\S]*?)<\/iframe>/.exec(page)?.[1] ?? ''
  const slot =
    /<div role="status" aria-live="polite" data-stored-band>\s*<\/div>/
  expect(stage).toMatch(slot)
  expect(stage.indexOf('data-stored-band')).toBeLessThan(
    stage.indexOf('<iframe'),
  )
  expect(page).toContain('<template data-stored-band-template>')
  expect(page).toContain('接続できないため、保存した版を表示しています。')
  expect(page).toContain('もう一度読み込む')
  expect(page.match(/<div role="status"/g)).toHaveLength(1)
})

test('Given a public deck, When its viewer is opened, Then the shell in the page is one attribute that holds the whole shell, escaped, naming only the version', async () => {
  const page = await (await get('/@owner/talk')).text()
  const attribute = /<div\s+hidden\s+[^>]*?data-offline-shell="([^"]*)"/.exec(
    page,
  )?.[1]
  expect(attribute).toBeTruthy()
  const shell = (attribute ?? '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
  expect(shell.startsWith('<!doctype html>')).toBe(true)
  expect(shell).toContain(`data-origin="https://d-${id}.content.example"`)
  // The content domain the script holds every origin to is the configured one.
  expect(shell).toContain('data-content-base="https://content.example"')
  expect(page).toMatch(/data-content-base="https:\/\/content\.example"/)
  expect(shell).toContain('<script type="module" src="/offline-client.js">')
  // The title is the author's: it is text, never markup.
  expect(shell).toContain('&lt;Talk&gt; &amp; &quot;friends&quot;')
  expect(shell).not.toContain('<Talk>')
  // Nothing of the reader: no cookie, no session, no sign-in.
  expect(shell).not.toMatch(/slide_owner|csrf|bearer|data-launch|name="token"/i)
})

test('F37-AC14: Given the viewer of a deck that is not public, When it is opened, Then there is no band and no shell', async () => {
  const response = await get('/@owner/draft')
  expect(response.status).toBe(404)
  const page = await response.text()
  expect(page).not.toContain('data-stored-band')
  expect(page).not.toContain('data-offline-shell')
})

test('F03-AC63: Given the viewer, When it is opened, Then it still frames only its own version and itself', async () => {
  const policy =
    (await get('/@owner/talk')).headers.get('Content-Security-Policy') ?? ''
  expect(policy).toContain(`frame-src https://d-${id}.content.example 'self';`)
})

test("Given the management eviction page, When it is asked for, Then only this origin may frame it, and it may frame the versions' origins and nothing else", async () => {
  const response = await get('/_offline/evict')
  expect(response.status).toBe(200)
  expect(response.headers.get('X-Frame-Options')).toBe('SAMEORIGIN')
  expect(response.headers.get('Content-Security-Policy')).toBe(
    "default-src 'none'; frame-src https://*.content.example; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  )
  const page = await response.text()
  expect(page).toContain('data-offline-evict')
  expect(page).toContain('src="/offline-client.js"')
})

test.each([
  ['iframe', 'same-origin', 200],
  ['iframe', 'same-site', 200],
  ['iframe', 'cross-site', 404],
  ['document', 'none', 404],
  ['document', 'same-origin', 404],
])(
  'F37-AC7: Given the management eviction page, When it is asked for as %s from %s, Then the answer is %i',
  async (dest, site, status) => {
    const response = await get('/_offline/evict', {
      'Sec-Fetch-Dest': dest,
      'Sec-Fetch-Site': site,
    })
    expect(response.status).toBe(status)
  },
)

test('Given the management eviction page, Then it holds the versions to the configured content domain', async () => {
  const page = await (await get('/_offline/evict')).text()
  expect(page).toContain('data-content-base="https://content.example"')
})
