import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { contentSessions, deployments } from '../db/schema'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'
import { readPublication } from './store'
import {
  OWNER_ID,
  resetTables,
  seedDeck,
  seedDeployment,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from './test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await seedDeck(db, 'talk')
})
afterAll(() => platform.dispose())

const page = async (cookie: string, query = '') => {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/slides/talk${query}`, {
      headers: { Cookie: cookie },
    }),
    env,
  )
  expect(response.status).toBe(200)
  // Compare markup regardless of how templates wrap lines.
  return (await response.text()).replace(/\s+/g, ' ')
}
const submit = (cookie: string, fields: Record<string, string>) =>
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
const state = async () =>
  (await readPublication(db, 'talk', OWNER_ID))?.publication

test('Given a draft and a ready version, When the page renders, Then it offers owner-only viewing and publishing without a replacement warning', async () => {
  const cookie = await signIn(env)
  const b = await seedDeployment(db, 'talk')
  const failed = await seedDeployment(db, 'talk', 'failed')
  const body = await page(cookie)
  expect(body).toContain('まだ公開していません')
  expect(body).toContain(
    `action="/slides/talk/deployments/${b}/preview" target="_blank"`,
  )
  expect(body).toContain(`name="deploymentId" value="${b}"`)
  expect(body).not.toContain(`name="deploymentId" value="${failed}"`)
  expect(body).not.toContain('その URL では開けなくなります')
})

test('Given A is public, When the page renders, Then A is marked public and B warns that A will stop', async () => {
  const cookie = await signIn(env)
  const a = await seedDeployment(db, 'talk')
  await submit(cookie, {
    action: 'publish',
    deploymentId: a,
    expectedRevision: '0',
  })
  await seedDeployment(db, 'talk')
  const body = await page(cookie)
  expect(body).toContain('公開中')
  expect(body).toContain(
    '公開中の版は置き換わり、その URL では開けなくなります',
  )
  expect(body).toContain('公開を止める')
})

test('Given the form, When publishing, pausing, and resuming, Then each redirects back with its result', async () => {
  const cookie = await signIn(env)
  const a = await seedDeployment(db, 'talk')
  const published = await submit(cookie, {
    action: 'publish',
    deploymentId: a,
    expectedRevision: '0',
  })
  expect(published.status).toBe(303)
  expect(published.headers.get('Location')).toBe('/slides/talk?result=applied')
  await submit(cookie, { action: 'pause', expectedRevision: '1' })
  expect(await state()).toEqual({ kind: 'paused', resumeTo: a })
  const body = await page(cookie, '?result=applied')
  expect(body).toContain('公開を止めています')
  expect(body).toContain('操作を反映しました。')
  await submit(cookie, { action: 'resume', expectedRevision: '2' })
  expect(await state()).toEqual({ kind: 'public', deploymentId: a })
})

test('Given a stale form, When submitted, Then the page explains the conflict and the current state stays', async () => {
  const cookie = await signIn(env)
  const a = await seedDeployment(db, 'talk')
  const b = await seedDeployment(db, 'talk')
  await submit(cookie, {
    action: 'publish',
    deploymentId: a,
    expectedRevision: '0',
  })
  const stale = await submit(cookie, {
    action: 'publish',
    deploymentId: b,
    expectedRevision: '0',
  })
  expect(stale.headers.get('Location')).toBe('/slides/talk?result=conflict')
  expect(await page(cookie, '?result=conflict')).toContain(
    '公開状態が変わったため、反映しませんでした',
  )
  expect(await state()).toEqual({ kind: 'public', deploymentId: a })
})

test.each(['draft', 'public', 'paused'] as const)(
  'F03-AC9 and F02-AC6: Given a %s slide, When its page is opened in either language, Then no publishing mode, no switch of it and no word of a repository, a workflow or CI shows',
  async (kind) => {
    const cookie = await signIn(env)
    const a = await seedDeployment(db, 'talk')
    if (kind !== 'draft')
      await submit(cookie, {
        action: 'publish',
        deploymentId: a,
        expectedRevision: '0',
      })
    if (kind === 'paused')
      await submit(cookie, { action: 'pause', expectedRevision: '1' })
    for (const body of [await page(cookie), await page(cookie, '?lang=en')]) {
      expect(body).not.toContain('name="mode"')
      expect(body).not.toContain('set_mode')
      expect(body).not.toMatch(
        /公開モード|リポジトリ|repository|GitHub から更新|workflow|\bCI\b|手動公開/i,
      )
      expect(body).not.toContain('/slides/new')
      expect(body).not.toContain('/slides/connect')
      expect(body).not.toContain('/reactions')
    }
  },
)

test('F02-AC6: Given a public slide, When the form asks to set the publishing mode, Then it reports an invalid request and the publication is unchanged', async () => {
  const cookie = await signIn(env)
  const a = await seedDeployment(db, 'talk')
  await submit(cookie, {
    action: 'publish',
    deploymentId: a,
    expectedRevision: '0',
  })
  const response = await submit(cookie, {
    action: 'set_mode',
    mode: 'repository',
    expectedRevision: '1',
  })
  expect(response.headers.get('Location')).toBe('/slides/talk?result=invalid')
  expect(await state()).toEqual({ kind: 'public', deploymentId: a })
})

test.each([
  ['a non-numeric revision', { action: 'pause', expectedRevision: 'x' }],
  ['an unknown action', { action: 'delete', expectedRevision: '0' }],
])(
  'Given %s, When submitted, Then it reports an invalid request',
  async (_, fields) => {
    const cookie = await signIn(env)
    const response = await submit(cookie, fields)
    expect(response.headers.get('Location')).toBe('/slides/talk?result=invalid')
  },
)

test('Given an unknown result value, When the page renders, Then no message is shown', async () => {
  const cookie = await signIn(env)
  expect(await page(cookie, '?result=<script>')).not.toContain('role="status"')
})

test('Given a cross-site form, When submitted, Then CSRF protection refuses it', async () => {
  const cookie = await signIn(env)
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/slides/talk/publication`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: 'https://evil.example',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'action=pause&expectedRevision=0',
    }),
    env,
  )
  expect(response.status).toBe(403)
  expect(await state()).toEqual({ kind: 'draft' })
})

test('Given A then B were received and B is public, When the page renders, Then A is offered as a rollback and a newer C as an update', async () => {
  const cookie = await signIn(env)
  const a = await seedDeployment(db, 'talk')
  const b = await seedDeployment(db, 'talk')
  const c = await seedDeployment(db, 'talk')
  await drizzle(db)
    .update(deployments)
    .set({ created_at: 10 })
    .where(eq(deployments.id, a))
  await drizzle(db)
    .update(deployments)
    .set({ created_at: 20 })
    .where(eq(deployments.id, b))
  await drizzle(db)
    .update(deployments)
    .set({ created_at: 30 })
    .where(eq(deployments.id, c))
  await submit(cookie, {
    action: 'publish',
    deploymentId: b,
    expectedRevision: '0',
  })
  const body = await page(cookie)
  expect(body).toContain('公開中の版より古い版に差し戻します。')
  expect(body).toContain('公開中の版をこの版に更新します。')
})

test('Given a paused deck, When the page renders, Then publishing a version says it ends the pause', async () => {
  const cookie = await signIn(env)
  const a = await seedDeployment(db, 'talk')
  await submit(cookie, {
    action: 'publish',
    deploymentId: a,
    expectedRevision: '0',
  })
  await submit(cookie, { action: 'pause', expectedRevision: '1' })
  await seedDeployment(db, 'talk')
  const body = await page(cookie)
  expect(body).toContain('停止を解除して、この版を一般公開します。')
  expect(body).toContain('もう一度公開する')
})

test('Given a draft viewed owner-only, When paused, Then the session ends', async () => {
  const cookie = await signIn(env)
  const b = await seedDeployment(db, 'talk')
  await drizzle(db).insert(contentSessions).values({
    token_hash: 's-b',
    deployment_id: b,
    owner_user_id: OWNER_ID,
    created_at: 1,
    expires_at: 9999999999,
    hard_expires_at: 9999999999,
  })
  await submit(cookie, { action: 'pause', expectedRevision: '0' })
  expect(await drizzle(db).$count(contentSessions)).toBe(0)
})

test('Given the owner session ended, When a form is submitted, Then the sign-in page is shown', async () => {
  const response = await submit('', { action: 'pause', expectedRevision: '0' })
  expect(response.status).toBe(401)
  expect(response.headers.get('Content-Type')).toContain('text/html')
  expect(await response.text()).toContain('GitHub でログイン')
})

test('Given two versions, When the deck is paused, Then the resume target names its deployment and marks only its row', async () => {
  const cookie = await signIn(env)
  // Given two ready versions
  const a = await seedDeployment(db, 'talk')
  const b = await seedDeployment(db, 'talk')
  await submit(cookie, {
    action: 'publish',
    deploymentId: a,
    expectedRevision: '0',
  })
  // When the public version is paused
  await submit(cookie, { action: 'pause', expectedRevision: '1' })
  const body = await page(cookie)
  // Then the state says publishing is stopped, without a deployment ID
  expect(body).toContain('公開を止めています')
  // And only that version's history row is marked
  const history = body.slice(body.indexOf('版の履歴'))
  const row = (id: string) =>
    history.split('<tr>').find((part) => part.includes(`<code>${id}</code>`))
  expect(row(a)).toContain('再開すると公開')
  expect(row(b)).not.toContain('再開すると公開')
  // And screen readers tell the two versions' buttons apart
  expect(row(a)).toContain(`aria-label="deployment ${a} を一般公開する"`)
  expect(row(b)).toContain(`aria-label="deployment ${b} を一般公開する"`)
  expect(row(a)).toMatch(
    new RegExp(`aria-describedby="resume-target-${a}( |")`),
  )
})

test.each([
  ['ja', '出どころ', 'ブラウザ'],
  ['en', 'Sent from', 'Browser'],
] as const)(
  'Given a version sent from a browser, When the page renders in %s, Then its history row says where it was sent from and names no commit',
  async (lang, heading, source) => {
    const cookie = await signIn(env)
    await seedDeployment(db, 'talk')

    const body = await page(cookie, `?lang=${lang}`)

    const history = body.slice(body.indexOf('data-deck-frame="history"'))
    expect(history).toContain(`<th>${heading}</th>`)
    expect(history).toContain(source)
    expect(history).not.toContain('commit')
  },
)
