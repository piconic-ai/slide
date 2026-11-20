import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import {
  contentSessions,
  decks,
  previewLaunches,
  uploadFiles,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { applyAuthorCommand } from '../publication/author'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
  seedDeck,
  seedDeployment,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

beforeAll(() => applyMigrations(db))
afterAll(() => platform.dispose())

let owner = ''
beforeEach(async () => {
  await resetTables(db)
  owner = await signIn(env)
})

const originOf = (id: string) => `https://d-${id}.content.example`

async function putIndex(id: string, body = '<h1>Draft</h1>') {
  const key = `${id}/0/lease`
  await platform.env.UPLOADS.put(key, body)
  await orm.insert(uploadFiles).values({
    deployment_id: id,
    id: '0',
    path: 'index.html',
    size: body.length,
    sha256: 'f'.repeat(64),
    media_type: 'text/html; charset=utf-8',
    object_key: key,
  })
}

const view = (path: string, cookie = '', useEnv = env) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, { headers: { Cookie: cookie } }),
    useEnv,
  )

/** The one-time token and where the page posts it. */
async function launchOf(response: Response) {
  const page = await response.text()
  return {
    page,
    action: (/<form[^>]*action="([^"]+)"/.exec(page)?.[1] ?? '').replaceAll(
      '&amp;',
      '&',
    ),
    token: /name="token" value="([^"]+)"/.exec(page)?.[1] ?? '',
  }
}

/** What the browser does with the form: post into the frame. */
const postLaunch = (action: string, token: string) =>
  server.fetch(
    new Request(action, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Sec-Fetch-Dest': 'iframe',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
      },
      body: new URLSearchParams({ token }).toString(),
    }),
    env,
  )

/** The frame moves itself to the slides after the launch: same-origin. */
const readInFrame = (
  id: string,
  cookie: string,
  site = 'same-origin',
  path = '/',
) =>
  server.fetch(
    new Request(`${originOf(id)}${path}`, {
      headers: {
        Cookie: cookie,
        'Sec-Fetch-Dest': 'iframe',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': site,
      },
    }),
    env,
  )

test('F02-AC18: Given a deck not yet public, When its author opens the viewer, Then the frame starts empty and a form posts a one-time token to the version’s origin', async () => {
  await seedDeck(db, 'talk')
  const id = await seedDeployment(db, 'talk')
  const response = await view('/@owner/talk', owner)
  expect(response.status).toBe(200)
  const { page, action, token } = await launchOf(response)
  expect(page).toMatch(/<iframe\s[^>]*name="deck-frame"/)
  expect(page).not.toMatch(/<iframe\s[^>]*src=/)
  expect(action).toBe(`${originOf(id)}/_preview/launch?lang=ja`)
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  const policy = response.headers.get('Content-Security-Policy') ?? ''
  expect(policy).toContain(`form-action ${originOf(id)};`)
  expect(policy).toContain(`frame-src ${originOf(id)} 'self'`)
})

test('F02-AC25: Given the viewer of a draft, When it is opened, Then the token is in no URL and the page is not stored', async () => {
  await seedDeck(db, 'talk')
  await seedDeployment(db, 'talk')
  const response = await view('/@owner/talk', owner)
  const { page, action, token } = await launchOf(response)
  expect(action).not.toContain(token)
  expect(page.replaceAll(`value="${token}"`, '')).not.toContain(token)
  expect(response.headers.get('Cache-Control')).toContain('no-store')
  expect(response.headers.get('X-Robots-Tag')).toBe('noindex')
  expect(page).toContain('rel="noreferrer"')
})

test('F02-AC21: Given the viewer of a draft, When it is opened, Then there is no share menu', async () => {
  await seedDeck(db, 'talk')
  await seedDeployment(db, 'talk')
  const page = await (await view('/@owner/talk', owner)).text()
  expect(page).not.toContain('share-menu')
  expect(page).not.toContain('id="share-url"')
})

test('F02-AC19: Given a draft, When someone not signed in or another author opens it, Then it is 404', async () => {
  await seedDeck(db, 'talk')
  await seedDeployment(db, 'talk')
  expect((await view('/@owner/talk')).status).toBe(404)
  const other = await signIn(withInvited(env), 'invited', { id: INVITED_ID })
  expect((await view('/@owner/talk', other, withInvited(env))).status).toBe(404)
})

test('F02-AC19: Given a deck of nothing received, When its author opens it, Then it is 404', async () => {
  await seedDeck(db, 'talk')
  await seedDeployment(db, 'talk', 'uploading')
  expect((await view('/@owner/talk', owner)).status).toBe(404)
})

test('F02-AC18: Given the form is posted in the frame, When the token is valid, Then a partitioned cookie opens the version in the frame, and the token works once', async () => {
  await seedDeck(db, 'talk')
  const id = await seedDeployment(db, 'talk')
  await putIndex(id)
  const { action, token } = await launchOf(await view('/@owner/talk', owner))
  const launched = await postLaunch(action, token)
  // Not a redirect: the frame moves itself, so the move is its own.
  expect(launched.status).toBe(200)
  expect(await launched.text()).toContain(
    '<meta http-equiv="refresh" content="0;url=/" />',
  )
  expect(launched.headers.get('Content-Security-Policy')).toContain(
    'frame-ancestors https://slide.example',
  )
  const set = launched.headers.getSetCookie()[0] ?? ''
  expect(set).toMatch(/^__Host-slide_preview=[A-Za-z0-9_-]{43};/)
  for (const part of [
    'Secure',
    'HttpOnly',
    'SameSite=None',
    'Partitioned',
    'Max-Age=300',
  ])
    expect(set).toContain(part)
  expect((await postLaunch(action, token)).status).toBe(403)
  const shown = await readInFrame(id, set.split(';')[0] ?? '')
  expect(shown.status).toBe(200)
  expect(await shown.text()).toContain('<h1>Draft</h1>')
})

test('F02-AC33: Given a launch token past its time, When it is posted, Then nothing opens', async () => {
  await seedDeck(db, 'talk')
  const id = await seedDeployment(db, 'talk')
  const { action, token } = await launchOf(await view('/@owner/talk', owner))
  await orm.run(sql`UPDATE preview_launches SET created_at = 0, expires_at = 1`)
  expect((await postLaunch(action, token)).status).toBe(403)
  expect(await orm.$count(contentSessions)).toBe(0)
  expect(id).toBeTruthy()
})

test('F02-AC34: Given a token for one version, When it is posted to another version’s origin, Then nothing opens', async () => {
  await seedDeck(db, 'talk')
  await seedDeployment(db, 'talk')
  const other = await seedDeployment(db, 'talk')
  const { token } = await launchOf(await view('/@owner/talk', owner))
  const wrong = `${originOf(other)}/_preview/launch`
  expect((await postLaunch(wrong, token)).status).toBe(403)
})

test('F02-AC35: Given a session for a draft, When it is presented on another slides’ origin, Then nothing is read', async () => {
  await seedDeck(db, 'talk')
  const id = await seedDeployment(db, 'talk')
  await putIndex(id)
  await seedDeck(db, 'other')
  const otherId = await seedDeployment(db, 'other')
  await putIndex(otherId, '<h1>Other</h1>')
  const { action, token } = await launchOf(await view('/@owner/talk', owner))
  const cookie = (await postLaunch(action, token)).headers
    .getSetCookie()[0]
    ?.split(';')[0]
  expect((await readInFrame(otherId, cookie ?? '')).status).not.toBe(200)
})

test.each([
  [
    'F02-AC26: Given a session, When publishing is paused, Then it reads nothing',
    async () => {
      await orm.update(decks).set({ public_deployment_id: null })
      await applyAuthorCommand(db, {
        deckId: 'talk',
        ownerUserId: OWNER_ID,
        command: { kind: 'pause' },
        expectedRevision: 0,
        now: 5,
      })
    },
  ],
  [
    'F02-AC27: Given a session, When the deck is deleted, Then it reads nothing',
    async () => {
      await orm.update(decks).set({ deleted_at: 5 }).where(eq(decks.id, 'talk'))
    },
  ],
  [
    'F02-AC28: Given a session, When the author is no longer one, Then it reads nothing',
    async () => {
      await orm.update(decks).set({ owner_user_id: '999' })
    },
  ],
])('%s', async (_name, change) => {
  await seedDeck(db, 'talk')
  const id = await seedDeployment(db, 'talk')
  await putIndex(id)
  const { action, token } = await launchOf(await view('/@owner/talk', owner))
  const cookie =
    (await postLaunch(action, token)).headers
      .getSetCookie()[0]
      ?.split(';')[0] ?? ''
  expect((await readInFrame(id, cookie)).status).toBe(200)
  await change()
  expect((await readInFrame(id, cookie)).status).not.toBe(200)
})

test('F02-AC36: Given a paused deck, When its author opens the viewer, Then the slides are there', async () => {
  const id = await seedPublic(db, 'talk', 1, 'Talk')
  await applyAuthorCommand(db, {
    deckId: 'talk',
    ownerUserId: OWNER_ID,
    command: { kind: 'pause' },
    expectedRevision: 0,
    now: 5,
  })
  const { action } = await launchOf(await view('/@owner/talk', owner))
  expect(action).toContain(originOf(id))
  expect((await view('/@owner/talk')).status).toBe(404)
})

test('F02-AC29: Given a public deck and a newer version, When its author asks for the newer, Then it is the one posted to, and readers still get the public version', async () => {
  const publicId = await seedPublic(db, 'talk', 1, 'Talk')
  const fresh = await seedDeployment(db, 'talk')
  await orm.run(sql`UPDATE deployments SET ready_at = 9 WHERE id = ${fresh}`)
  const { action } = await launchOf(
    await view(`/@owner/talk?v=${fresh}`, owner),
  )
  expect(action).toContain(originOf(fresh))
  const plain = await view('/@owner/talk', owner)
  expect(await plain.text()).toContain(`src="${originOf(publicId)}/"`)
  const reader = await (await view(`/@owner/talk?v=${fresh}`)).text()
  expect(reader).toContain(`src="${originOf(publicId)}/"`)
  expect(reader).not.toContain('data-launch')
})

test('F02-AC31: Given the newer version asked for in the address, When the viewer is made, Then the share URL and the embed code do not carry it', async () => {
  await seedPublic(db, 'talk', 1, 'Talk')
  const fresh = await seedDeployment(db, 'talk')
  const page = await (await view(`/@owner/talk?v=${fresh}`, owner)).text()
  expect(page).not.toContain('share-menu')
  expect(page).toContain(
    '<meta property="og:url" content="https://slide.example/@owner/talk" />',
  )
  const readers = await (await view(`/@owner/talk?v=${fresh}`)).text()
  expect(readers).toContain(
    '<meta property="og:url" content="https://slide.example/@owner/talk" />',
  )
  expect(readers).toContain('value="https://slide.example/@owner/talk"')
})

test('F02-AC41: Given a version ID the deck does not have, When the author asks for it, Then it is 404, not another version', async () => {
  await seedPublic(db, 'talk', 1, 'Talk')
  await seedDeck(db, 'theirs', '1')
  const foreign = await seedDeployment(db, 'theirs')
  expect((await view(`/@owner/talk?v=${foreign}`, owner)).status).toBe(404)
  expect(
    (await view(`/@owner/talk?v=${crypto.randomUUID()}`, owner)).status,
  ).toBe(404)
  // Readers are not told: they get the public version whatever they ask.
  expect((await view(`/@owner/talk?v=${foreign}`)).status).toBe(200)
})

test('F02-AC42: Given more than fifty received versions, When the author asks for the oldest, Then it is that version that opens', async () => {
  await seedDeck(db, 'talk')
  const oldest = await seedDeployment(db, 'talk')
  await orm.run(sql`UPDATE deployments SET ready_at = 1 WHERE id = ${oldest}`)
  for (let i = 0; i < 55; i++) {
    const id = await seedDeployment(db, 'talk')
    await orm.run(
      sql`UPDATE deployments SET ready_at = ${10 + i} WHERE id = ${id}`,
    )
  }
  const r = await view(`/@owner/talk?v=${oldest}`, owner)
  const { action } = await launchOf(r)
  expect(action).toContain(originOf(oldest))
})

test('F02-AC25: Given requests that are not the author reading the page, When the viewer is asked for, Then no token is made', async () => {
  await seedDeck(db, 'talk')
  await seedDeployment(db, 'talk')
  const ask = (init: RequestInit) =>
    server.fetch(
      new Request(`${TEST_ORIGIN}/@owner/talk`, {
        ...init,
        headers: { Cookie: owner, ...(init.headers as object) },
      }),
      env,
    )
  await ask({ method: 'HEAD' })
  await ask({ headers: { 'Sec-Purpose': 'prefetch' } })
  await ask({ headers: { 'Sec-Fetch-Dest': 'image' } })
  expect(await orm.$count(previewLaunches)).toBe(0)
  await ask({ headers: { 'Sec-Fetch-Dest': 'document' } })
  expect(await orm.$count(previewLaunches)).toBe(1)
})

test('F02-AC25: Given an author who opens the viewer again and again, When many tokens are unused, Then only the newest few are kept', async () => {
  await seedDeck(db, 'talk')
  await seedDeployment(db, 'talk')
  for (let i = 0; i < 30; i++) await view('/@owner/talk', owner)
  expect(await orm.$count(previewLaunches)).toBe(20)
})

test('F02-AC19: Given an author no longer on the list, When they open their draft, Then it is 404 like for anyone', async () => {
  await seedDeck(db, 'talk')
  await seedDeployment(db, 'talk')
  const removed = { ...env, AUTHOR_GITHUB_IDS: INVITED_ID } as unknown as Env
  expect((await view('/@owner/talk', owner, removed)).status).toBe(404)
})

test('F02-AC33: Given a session opened in the frame, When it is stored, Then it lasts five minutes and is not renewed', async () => {
  await seedDeck(db, 'talk')
  await seedDeployment(db, 'talk')
  const { action, token } = await launchOf(await view('/@owner/talk', owner))
  await postLaunch(action, token)
  const row = await orm.select().from(contentSessions).get()
  expect(row ? row.expires_at - row.created_at : 0).toBe(300)
  expect(row?.hard_expires_at).toBe(row?.expires_at)
})

test('F02-AC24: Given a session for a draft, When a frame of another site asks, Then it is not shown, and the answer is the plain one', async () => {
  await seedDeck(db, 'talk')
  const id = await seedDeployment(db, 'talk')
  await putIndex(id, '<h1>Secret</h1>')
  const { action, token } = await launchOf(await view('/@owner/talk', owner))
  const cookie =
    (await postLaunch(action, token)).headers
      .getSetCookie()[0]
      ?.split(';')[0] ?? ''
  for (const site of ['cross-site', 'same-site']) {
    const shown = await readInFrame(id, cookie, site)
    expect(shown.status).toBe(404)
    expect(await shown.text()).toBe('Not found')
  }
})

test('F02-AC18: Given the viewer’s frame gets no session, When it asks the version’s origin, Then it is told apart: no cookie kept, or the session ended', async () => {
  await seedDeck(db, 'talk')
  const id = await seedDeployment(db, 'talk')
  await putIndex(id, '<h1>Secret</h1>')
  const none = await readInFrame(id, '')
  expect(none.status).toBe(404)
  const noneBody = await none.text()
  expect(noneBody).toContain("reason: 'unsupported'")
  expect(noneBody).not.toContain('Secret')
  expect(none.headers.get('Content-Security-Policy')).toContain(
    'frame-ancestors https://slide.example',
  )
  const ended = await readInFrame(id, `__Host-slide_preview=${'a'.repeat(43)}`)
  expect(ended.status).toBe(401)
  expect(await ended.text()).toContain("reason: 'expired'")
})

test('F02-AC44: Given a deck with a page in the address, When its author opens the draft, Then the page goes to the launch', async () => {
  await seedDeck(db, 'talk')
  await seedDeployment(db, 'talk')
  const { action } = await launchOf(await view('/@owner/talk/4', owner))
  expect(action).toMatch(/\?lang=ja&page=4$/)
})
