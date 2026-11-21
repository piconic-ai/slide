import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy, unstable_readConfig } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { isIndexablePath } from '../site/indexing'
import { limitGroupOf } from '../site/rate-limit-policy'
import {
  INVITED_ID,
  resetTables,
  seedDeck,
  seedDeployment,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
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
    new Request(`${TEST_ORIGIN}/api/slides/talk/publication`, {
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
  expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform')
  expect(response.headers.get('X-Robots-Tag')).toBeNull()
  expect(response.headers.get('X-Frame-Options')).toBe('DENY')
  expect(response.headers.get('Content-Security-Policy')).toBe(
    `default-src 'none'; frame-src ${origin} 'self'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; img-src 'self' https://avatars.githubusercontent.com https://*.content.example; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
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

test('F17-AC16: Given a public deck, When its viewer is opened, Then reporting that deck is one item of the “more” menu, and not in the share menu', async () => {
  const id = await seedDeployment(db, 'talk')
  await act({ action: 'publish', deploymentId: id })
  const page = await (await view('/@owner/talk')).text()
  const menu =
    /<details class="action-menu more-menu" data-menu>([\s\S]*?)<\/details>/.exec(
      page,
    )?.[1]
  expect(menu).toMatch(
    /<summary class="button-icon" aria-label="そのほかの操作" aria-expanded="false">\s*<span aria-hidden="true">⋯<\/span>\s*<\/summary>/,
  )
  expect(menu).toContain('href="/reports/new?slide=%2F%40owner%2Ftalk"')
  expect(menu).toContain('通報する')
  // The share menu holds no way to report.
  const share =
    /<details class="action-menu share-menu" data-menu>([\s\S]*?)<\/details>/.exec(
      page,
    )?.[1]
  expect(share).toContain('URL をコピー')
  expect(share).not.toContain('/reports/new')
})

test('F17-AC16: Given a share URL with a page number, When its viewer is opened, Then the report link carries that page', async () => {
  const id = await seedDeployment(db, 'talk')
  await act({ action: 'publish', deploymentId: id })
  const page = await (await view('/@owner/talk/3')).text()
  expect(page).toContain('href="/reports/new?slide=%2F%40owner%2Ftalk%2F3"')
})

test('F03-AC13: Given a share URL with a page number, When its viewer is opened, Then the link the menu copies is the share URL without the page', async () => {
  const id = await seedDeployment(db, 'talk')
  await act({ action: 'publish', deploymentId: id })
  const page = await (await view('/@owner/talk/3')).text()
  expect(frameSource(page)).toBe(`https://d-${id}.content.example/#3`)
  const field = /<input\b[^>]*id="share-url"[^>]*>/.exec(page)?.[0]
  expect(field).toContain(`value="${TEST_ORIGIN}/@owner/talk"`)
  // The page's own URL is known only once the slides tell their page.
  expect(page).not.toContain(`value="${TEST_ORIGIN}/@owner/talk/3"`)
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

test('Given the deck page, When the deck is a draft or public, Then it shows the share URL with a copy action, and a way to open it only once public', async () => {
  const deckPage = async () =>
    (
      await server.fetch(
        new Request(`${TEST_ORIGIN}/slides/talk`, {
          headers: { Cookie: owner },
        }),
        env,
      )
    ).text()
  const id = await seedDeployment(db, 'talk')
  const draft = await deckPage()
  expect(draft).toContain(`value="${TEST_ORIGIN}/@owner/talk"`)
  expect(draft).toContain('公開すると、この URL で読めます。')
  expect(draft).not.toContain(`<a href="${TEST_ORIGIN}/@owner/talk">`)
  await act({ action: 'publish', deploymentId: id })
  const page = await deckPage()
  expect(page).toMatch(
    new RegExp(
      `<a\\s+class="tap-area"\\s+href="${TEST_ORIGIN.replace(/[.]/g, '\\.')}/@owner/talk"\\s*>\\s*開く\\s*</a\\s*>`,
    ),
  )
  expect(page).toContain(`value="${TEST_ORIGIN}/@owner/talk"`)
  expect(page).toContain('data-copy="share-url"')
  expect(page).toContain('<script src="/share.js" defer></script>')
})

test('F03-AC7: Given a public deck and a link it makes to itself, When its viewer is opened, Then no timeline of posts, no event and no running frame of another deck shows, and only the deck is framed', async () => {
  const id = await seedDeployment(db, 'talk')
  await act({ action: 'publish', deploymentId: id })
  await db.batch([
    db.prepare(
      `INSERT INTO citations (deployment_id, target_handle, target_slug, target_page) VALUES ('${id}', 'owner', 'talk', 2)`,
    ),
  ])

  const response = await view('/@owner/talk')
  expect(response.status).toBe(200)
  const page = await response.text()

  for (const gone of [
    'data-embed',
    'platform.twitter.com',
    'class="timeline"',
    'id="reactions"',
    'ToKyoto.js',
    'Kyoto.js',
    'kyotojs',
    'class="events"',
    'data-mini',
  ])
    expect(page).not.toContain(gone)
  expect(page.match(/<iframe\b/g)).toHaveLength(1)
  expect(response.headers.get('Content-Security-Policy')).toContain(
    `frame-src https://d-${id}.content.example 'self';`,
  )
})

test('F03-AC8: Given a public deck, When its viewer is opened, Then under the slides come the title, the author, the three actions, the description and the places for citations, in that order', async () => {
  const id = await seedDeployment(db, 'talk')
  await act({ action: 'publish', deploymentId: id })
  await db
    .prepare('UPDATE deployments SET title = ?, description = ? WHERE id = ?')
    .bind('Good talk', 'What it is about', id)
    .run()

  const page = await (await view('/@owner/talk')).text()

  const order = [
    '<iframe',
    '<h1>Good talk</h1>',
    'class="viewer-author"',
    'class="viewer-actions"',
    'class="viewer-description"',
    'data-reader-lists="cites"',
    'data-reader-lists="cited-by"',
  ].map((part) => page.indexOf(part))
  expect(order.every((at) => at > -1)).toBe(true)
  expect(order).toEqual([...order].sort((a, b) => a - b))
  // Exactly three actions: full screen, share, and the rest.
  const actions = page.slice(order[3], order[4])
  expect(actions.match(/<button\b[^>]*data-fullscreen="deck"/g)).toHaveLength(1)
  expect(actions.match(/<summary\b/g)).toHaveLength(2)
  expect(actions).toMatch(
    /<summary class="button-primary"[^>]*>共有<\/summary>/,
  )
  expect(actions).toContain('aria-label="そのほかの操作"')
  expect(actions).toContain('href="/reports/new?slide=%2F%40owner%2Ftalk"')
  // The header is the one every page shares.
  expect(page).toContain('<header class="site-header">')
  expect(page).not.toContain('class="langs"')
})

test('F03-AC8: Given a reader signed in as someone else, When the viewer is opened, Then the “more” menu leads to reporting and to muting the author', async () => {
  const id = await seedDeployment(db, 'talk')
  await act({ action: 'publish', deploymentId: id })
  const invited = withInvited(env)
  const reader = await signIn(invited, 'reader', { id: INVITED_ID })

  const page = await (
    await server.fetch(
      new Request(`${TEST_ORIGIN}/@owner/talk`, {
        headers: { Cookie: reader },
      }),
      invited,
    )
  ).text()

  const menu =
    /<details class="action-menu more-menu" data-menu>([\s\S]*?)<\/details>/.exec(
      page,
    )?.[1] ?? ''
  expect(menu).toContain('href="/reports/new?slide=%2F%40owner%2Ftalk"')
  expect(menu).toContain(
    'href="/mutes/new?handle=owner&amp;slide=%2F%40owner%2Ftalk"',
  )
  expect(menu).toMatch(/>\s*この作者をミュート\s*<\/a/)
})

const viewerAs = async (
  cookie: string | null,
  environment = env,
  path = '/@owner/talk',
) => {
  const response = await server.fetch(
    new Request(
      `${TEST_ORIGIN}${path}`,
      cookie ? { headers: { Cookie: cookie } } : {},
    ),
    environment,
  )
  expect(response.status).toBe(200)
  return response.text()
}

test('F03-AC29 F03-AC30: Given the author opens the viewer of their own public slides, When it is drawn, Then “edit” leads the actions and opens the slides’ editing page', async () => {
  await act({
    action: 'publish',
    deploymentId: await seedDeployment(db, 'talk'),
  })
  const page = await viewerAs(owner)
  const actions = /class="viewer-actions"[\s\S]*?<\/div>/.exec(page)?.[0] ?? ''
  expect(actions).toMatch(
    /<a class="button-secondary" href="\/slides\/talk"\s*>編集する<\/a/,
  )
  expect(actions.indexOf('編集する')).toBeLessThan(
    actions.indexOf('data-fullscreen'),
  )
})

test('F03-AC31: Given another author signed in, When they open the viewer, Then there is no “edit”', async () => {
  await act({
    action: 'publish',
    deploymentId: await seedDeployment(db, 'talk'),
  })
  const invited = withInvited(env)
  const other = await signIn(invited, 'other-author', { id: INVITED_ID })
  expect(await viewerAs(other, invited)).not.toContain('編集する')
})

test('F03-AC32: Given nobody signed in, When the viewer is opened, Then there is no “edit”', async () => {
  await act({
    action: 'publish',
    deploymentId: await seedDeployment(db, 'talk'),
  })
  expect(await viewerAs(null)).not.toContain('編集する')
})
