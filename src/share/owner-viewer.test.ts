import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { contentSessions, decks, uploadFiles } from '../db/schema'
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
    action: (
      /<form[^>]*?action="([^"]+)"[^>]*?data-launch/.exec(page)?.[1] ?? ''
    ).replaceAll('&amp;', '&'),
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

const readInFrame = (id: string, cookie: string, path = '/') =>
  server.fetch(
    new Request(`${originOf(id)}${path}`, {
      headers: {
        Cookie: cookie,
        'Sec-Fetch-Dest': 'iframe',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
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
  expect(policy).toContain(`form-action ${originOf(id)} 'self';`)
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
  expect(launched.status).toBe(303)
  expect(launched.headers.get('Location')).toBe('/')
  const set = launched.headers.getSetCookie()[0] ?? ''
  expect(set).toMatch(/^__Host-slide_preview=[A-Za-z0-9_-]{43};/)
  for (const part of ['Secure', 'HttpOnly', 'SameSite=None', 'Partitioned'])
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

test('F02-AC30: Given a stranger’s version ID, When the author asks for it, Then the public version shows', async () => {
  const publicId = await seedPublic(db, 'talk', 1, 'Talk')
  await seedDeck(db, 'theirs', '1')
  const foreign = await seedDeployment(db, 'theirs')
  const page = await (await view(`/@owner/talk?v=${foreign}`, owner)).text()
  expect(page).toContain(`src="${originOf(publicId)}/"`)
})

test('F02-AC44: Given a deck with a page in the address, When its author opens the draft, Then the page goes to the launch', async () => {
  await seedDeck(db, 'talk')
  await seedDeployment(db, 'talk')
  const { action } = await launchOf(await view('/@owner/talk/4', owner))
  expect(action).toMatch(/\?lang=ja&page=4$/)
})

const publish = (cookie: string, fields: Record<string, string>) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/slides/talk/publication`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields).toString(),
    }),
    env,
  )

/** The publication form of the notice, as the browser would send it. */
function noticeFields(page: string) {
  const form =
    /<div class="viewer-notice"[\s\S]*?<\/form>/.exec(page)?.[0] ?? ''
  return {
    action: /action="([^"]+)"/.exec(form)?.[1] ?? '',
    fields: Object.fromEntries(
      [...form.matchAll(/name="(\w+)"\s+value="([^"]*)"/g)].map((m) => [
        m[1] ?? '',
        m[2] ?? '',
      ]),
    ),
  }
}

test('F02-AC20: Given a draft, When its author opens the viewer, Then the notice and the button to publish are above the slides', async () => {
  await seedDeck(db, 'talk')
  await seedDeployment(db, 'talk')
  const page = await (await view('/@owner/talk', owner)).text()
  expect(page).toContain('まだ公開していません。いまはあなただけが見ています。')
  expect(page).toContain('公開する')
  expect(page.indexOf('viewer-notice')).toBeLessThan(
    page.indexOf('class="stage"'),
  )
})

test('F02-AC22: Given the notice of a draft, When its button is pressed, Then readers can open the same URL, the notice is gone and the share menu is there', async () => {
  await seedDeck(db, 'talk')
  const id = await seedDeployment(db, 'talk')
  const { action, fields } = noticeFields(
    await (await view('/@owner/talk', owner)).text(),
  )
  const done = await publish(owner, fields)
  expect(action).toBe('/slides/talk/publication')
  expect(done.status).toBe(303)
  expect(done.headers.get('Location')).toBe('/@owner/talk')
  const reader = await view('/@owner/talk')
  expect(reader.status).toBe(200)
  expect(await reader.text()).toContain(originOf(id))
  const after = await (await view('/@owner/talk', owner)).text()
  expect(after).not.toContain('viewer-notice"')
  expect(after).toContain('share-menu')
})

test('F02-AC37: Given a paused deck, When its author opens the viewer, Then the notice says it is paused and offers to publish again', async () => {
  await seedPublic(db, 'talk', 1, 'Talk')
  await applyAuthorCommand(db, {
    deckId: 'talk',
    ownerUserId: OWNER_ID,
    command: { kind: 'pause' },
    expectedRevision: 0,
    now: 5,
  })
  const page = await (await view('/@owner/talk', owner)).text()
  expect(page).toContain('公開を止めています。いま読者には見えません。')
  expect(page).toContain('もう一度公開する')
  expect((await view('/@owner/talk')).status).toBe(404)
})

test('F02-AC39: Given the notice of a paused deck, When its button is pressed, Then readers can open the URL', async () => {
  await seedPublic(db, 'talk', 1, 'Talk')
  await applyAuthorCommand(db, {
    deckId: 'talk',
    ownerUserId: OWNER_ID,
    command: { kind: 'pause' },
    expectedRevision: 0,
    now: 5,
  })
  const { fields } = noticeFields(
    await (await view('/@owner/talk', owner)).text(),
  )
  expect((await publish(owner, fields)).status).toBe(303)
  expect((await view('/@owner/talk')).status).toBe(200)
})

test('F02-AC41: Given a new version, When its author opens it, Then the notice says it is not public and offers to publish it', async () => {
  await seedPublic(db, 'talk', 1, 'Talk')
  const fresh = await seedDeployment(db, 'talk')
  const page = await (await view(`/@owner/talk?v=${fresh}`, owner)).text()
  expect(page).toContain('いま見ているのは、まだ公開していない新しい版です。')
  expect(page).toContain('この版を公開する')
  expect(noticeFields(page).fields.deploymentId).toBe(fresh)
})

test('F02-AC22: Given a notice whose revision is old, When the button is pressed, Then nothing is published and the deck page explains', async () => {
  await seedDeck(db, 'talk')
  await seedDeployment(db, 'talk')
  const { fields } = noticeFields(
    await (await view('/@owner/talk', owner)).text(),
  )
  const stale = await publish(owner, { ...fields, expectedRevision: '7' })
  expect(stale.headers.get('Location')).toBe('/slides/talk?result=conflict')
  expect((await view('/@owner/talk')).status).toBe(404)
})

test('F02-AC18: Given a frame that cannot show the version, When it asks the version’s origin without a session, Then it gets a page that tells the viewer, and nothing of the draft', async () => {
  await seedDeck(db, 'talk')
  const id = await seedDeployment(db, 'talk')
  await putIndex(id, '<h1>Secret</h1>')
  const shown = await readInFrame(id, '')
  expect(shown.status).toBe(404)
  const body = await shown.text()
  expect(body).toContain('slide:preview-unavailable')
  expect(body).not.toContain('Secret')
  expect(shown.headers.get('Content-Security-Policy')).toContain(
    'frame-ancestors https://slide.example',
  )
})
