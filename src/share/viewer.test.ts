import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy, unstable_readConfig } from 'wrangler'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'
import { isIndexablePath } from '../site/indexing'
import { limitGroupOf } from '../site/rate-limit-policy'
import {
  resetTables,
  seedDeck,
  seedDeployment,
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

let owner = ''
let revision = 0
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await seedDeck(db, 'talk')
  // Signing in records the handle "owner" from the stubbed GitHub login.
  owner = await signIn(env)
  revision = 0
})
afterAll(() => platform.dispose())

const view = (path: string, environment = env) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`), environment)

async function act(body: Record<string, unknown>) {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/api/decks/talk/publication`, {
      method: 'POST',
      headers: {
        Cookie: owner,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...body, expectedRevision: revision }),
    }),
    env,
  )
  expect(response.status).toBe(200)
  revision++
}

const frameSource = (page: string) =>
  /<iframe\s[^>]*src="([^"]+)"/.exec(page)?.[1] ?? null

async function expectUnavailable(response: Response) {
  expect(response.status).toBe(404)
  const body = await response.text()
  expect(body).toContain('この資料は公開されていません')
  expect(frameSource(body)).toBeNull()
  expect(response.headers.get('X-Robots-Tag')).toBe('noindex')
}

test('Given a public deck, When its share URL is opened, Then the viewer frames that deployment in a sandbox', async () => {
  const id = await seedDeployment(db, 'talk')
  await act({ action: 'publish', deploymentId: id })
  const response = await view('/@owner/talk')
  expect(response.status).toBe(200)
  const page = await response.text()
  const origin = `https://d-${id}.content.example`
  expect(frameSource(page)).toBe(`${origin}/`)
  expect(page).toContain('sandbox="allow-scripts allow-same-origin"')
  expect(page).toContain(`value="${TEST_ORIGIN}/@owner/talk"`)
  expect(response.headers.get('Cache-Control')).toBe('no-cache')
  expect(response.headers.get('X-Robots-Tag')).toBeNull()
  expect(response.headers.get('X-Frame-Options')).toBe('DENY')
  expect(response.headers.get('Content-Security-Policy')).toBe(
    `default-src 'none'; frame-src ${origin}; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  )
})

test('Given a public deck is replaced, When the share URL is opened, Then it frames the new deployment', async () => {
  const first = await seedDeployment(db, 'talk')
  const second = await seedDeployment(db, 'talk')
  await act({ action: 'publish', deploymentId: first })
  await act({ action: 'publish', deploymentId: second })
  const page = await (await view('/@owner/talk')).text()
  expect(frameSource(page)).toBe(`https://d-${second}.content.example/`)
})

test('Given a draft deck with a ready deployment, When its share URL is opened, Then it is unavailable', async () => {
  await seedDeployment(db, 'talk')
  await expectUnavailable(await view('/@owner/talk'))
})

test('Given a paused deck, When its share URL is opened, Then it is unavailable', async () => {
  const id = await seedDeployment(db, 'talk')
  await act({ action: 'publish', deploymentId: id })
  await act({ action: 'pause' })
  await expectUnavailable(await view('/@owner/talk'))
})

test.each(['/@owner/missing', '/@someone/talk', '/@owner/-x', '/@a_b/talk'])(
  'Given %s, When opened, Then it looks the same as an unpublished deck',
  async (path) => {
    const id = await seedDeployment(db, 'talk')
    await act({ action: 'publish', deploymentId: id })
    await expectUnavailable(await view(path))
  },
)

test('Given content delivery is not configured, When a public share URL is opened, Then it is unavailable', async () => {
  const id = await seedDeployment(db, 'talk')
  await act({ action: 'publish', deploymentId: id })
  await expectUnavailable(
    await view('/@owner/talk', {
      ...env,
      CONTENT_ORIGIN: '',
    } as unknown as Env),
  )
})

test.each([
  '/@Owner/Talk',
  '/@owner/talk/',
  '/%40owner/talk',
  '/@owner/t%61lk',
])(
  'Given the spelling %s, When opened, Then it redirects to the canonical share URL',
  async (path) => {
    const response = await view(path)
    expect(response.status).toBe(301)
    expect(response.headers.get('Location')).toBe('/@owner/talk')
    expect(response.headers.get('Cache-Control')).toBe('no-cache')
  },
)

test.each(['/@owner/talk/extra', '/%40', '/@owner%2Ftalk/x'])(
  'Given %s under share URLs, When opened, Then it is the unavailable page, not indexed',
  async (path) => {
    const id = await seedDeployment(db, 'talk')
    await act({ action: 'publish', deploymentId: id })
    await expectUnavailable(await view(path))
  },
)

test('Given a public deck, When its share URL is requested with HEAD, Then it answers like GET without a body', async () => {
  const id = await seedDeployment(db, 'talk')
  await act({ action: 'publish', deploymentId: id })
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/@owner/talk`, { method: 'HEAD' }),
    env,
  )
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('')
})

test('Given share URLs, When grouped for rate limits, Then they count against the viewer budget', () => {
  expect(limitGroupOf('/@owner/talk')).toBe('viewer')
  expect(limitGroupOf('/%40owner/talk')).toBe('viewer')
  const { ratelimits } = unstable_readConfig({ config: 'wrangler.jsonc' })
  expect(
    ratelimits?.find(
      (binding: { name: string }) => binding.name === 'VIEWER_RATE_LIMITER',
    )?.simple,
  ).toEqual({ limit: 600, period: 60 })
})

test('Given an error page under share URLs, When answered, Then only a 200 viewer may be indexed', async () => {
  expect(isIndexablePath('/@owner/talk')).toBe(true)
  const response = await view('/@owner/talk')
  expect(response.status).toBe(404)
  expect(response.headers.get('X-Robots-Tag')).toBe('noindex')
  const missing = await view('/missing')
  expect(missing.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
})

test('Given the deck page, When the deck is public, Then it shows the share URL with a copy action; as a draft it does not', async () => {
  const deckPage = async () =>
    (
      await server.fetch(
        new Request(`${TEST_ORIGIN}/decks/talk`, {
          headers: { Cookie: owner },
        }),
        env,
      )
    ).text()
  const id = await seedDeployment(db, 'talk')
  expect(await deckPage()).not.toContain('共有 URL')
  await act({ action: 'publish', deploymentId: id })
  const page = await deckPage()
  expect(page).toContain(`value="${TEST_ORIGIN}/@owner/talk"`)
  expect(page).toContain('data-copy="share-url"')
  expect(page).toContain('<script src="/share.js" defer></script>')
})
