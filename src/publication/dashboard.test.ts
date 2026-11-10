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
    new Request(`${TEST_ORIGIN}/decks/talk${query}`, {
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
    new Request(`${TEST_ORIGIN}/decks/talk/publication`, {
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
  expect(body).toContain('下書きのみ')
  expect(body).toContain(
    `action="/decks/talk/deployments/${b}/preview" target="_blank"`,
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
  expect(body).toContain('一般公開中')
  expect(body).toContain(
    '公開中の版は置き換わり、その URL では開けなくなります',
  )
  expect(body).toContain('公開を停止する')
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
  expect(published.headers.get('Location')).toBe('/decks/talk?result=applied')
  await submit(cookie, { action: 'pause', expectedRevision: '1' })
  expect(await state()).toEqual({ kind: 'paused', resumeTo: a })
  const body = await page(cookie, '?result=applied')
  expect(body).toContain('公開停止中（再開すると')
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
  expect(stale.headers.get('Location')).toBe('/decks/talk?result=conflict')
  expect(await page(cookie, '?result=conflict')).toContain(
    '公開状態が変わったため、反映しませんでした',
  )
  expect(await state()).toEqual({ kind: 'public', deploymentId: a })
})

test('Given the mode form, When submitted, Then the mode switches and the page offers switching back', async () => {
  const cookie = await signIn(env)
  await submit(cookie, {
    action: 'set_mode',
    mode: 'repository',
    expectedRevision: '0',
  })
  const body = await page(cookie)
  expect(body).toContain('公開モード: リポジトリ設定に従う')
  expect(body).toContain('name="mode" value="manual"')
})

test.each([
  ['a non-numeric revision', { action: 'pause', expectedRevision: 'x' }],
  ['an unknown action', { action: 'delete', expectedRevision: '0' }],
])(
  'Given %s, When submitted, Then it reports an invalid request',
  async (_, fields) => {
    const cookie = await signIn(env)
    const response = await submit(cookie, fields)
    expect(response.headers.get('Location')).toBe('/decks/talk?result=invalid')
  },
)

test('Given an unknown result value, When the page renders, Then no message is shown', async () => {
  const cookie = await signIn(env)
  expect(await page(cookie, '?result=<script>')).not.toContain('role="status"')
})

test('Given a cross-site form, When submitted, Then CSRF protection refuses it', async () => {
  const cookie = await signIn(env)
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/decks/talk/publication`, {
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
  expect(body).toContain('公開中の bbbbbbbbbbbb より古い版に差し戻します。')
  expect(body).toContain('公開中の bbbbbbbbbbbb をこの版に更新します。')
})

test('Given the public version is not on the shown history page, When the page renders, Then its commit is still shown', async () => {
  const cookie = await signIn(env)
  const a = await seedDeployment(db, 'talk')
  await submit(cookie, {
    action: 'publish',
    deploymentId: a,
    expectedRevision: '0',
  })
  const body = await page(cookie, '?before=1.0')
  expect(body).toMatch(/一般公開中: <code ?>bbbbbbbbbbbb<\/code ?>/)
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
  expect(body).toContain('公開を再開する')
})

test('Given a draft viewed owner-only, When paused, Then the note warns beforehand and the session ends', async () => {
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
  const body = await page(cookie)
  expect(body).toContain('停止すると作者限定の閲覧も開き直しが必要になり')
  expect(body).not.toContain('匿名の読者は開けなくなり')
  await submit(cookie, { action: 'pause', expectedRevision: '0' })
  expect(await drizzle(db).$count(contentSessions)).toBe(0)
})

test('Given the owner session ended, When a form is submitted, Then the sign-in page is shown', async () => {
  const response = await submit('', { action: 'pause', expectedRevision: '0' })
  expect(response.status).toBe(401)
  expect(response.headers.get('Content-Type')).toContain('text/html')
  expect(await response.text()).toContain('GitHub でログイン')
})

test('Given two versions of the same commit, When the deck is paused, Then the resume target names its deployment and marks only its row', async () => {
  const cookie = await signIn(env)
  // Given two ready versions; the test seeds every version with one commit
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
  // Then the state names the deployment a resume brings back
  expect(body).toMatch(
    new RegExp(
      `再開すると <code>b{12}</code>（deployment <code>${a}</code>）を一般公開します`,
    ),
  )
  // And only that version's history row is marked
  const history = body.slice(body.indexOf('受領履歴'))
  const row = (id: string) =>
    history.split('<tr>').find((part) => part.includes(`<code>${id}</code>`))
  expect(row(a)).toContain('再開すると公開')
  expect(row(b)).not.toContain('再開すると公開')
  // And screen readers tell the two versions' buttons apart
  expect(row(a)).toContain(
    `aria-label="bbbbbbbbbbbb（deployment ${a}） を一般公開する"`,
  )
  expect(row(b)).toContain(
    `aria-label="bbbbbbbbbbbb（deployment ${b}） を一般公開する"`,
  )
  expect(row(a)).toMatch(
    new RegExp(`aria-describedby="resume-target-${a}( |")`),
  )
})

test('Given a public version, When the page renders, Then the state names its deployment', async () => {
  // Given a published version
  const cookie = await signIn(env)
  const a = await seedDeployment(db, 'talk')
  await submit(cookie, {
    action: 'publish',
    deploymentId: a,
    expectedRevision: '0',
  })
  // When the deck page renders
  const body = await page(cookie)
  // Then the state names it, and no row is marked as a resume target
  expect(body).toContain(`（deployment <code>${a}</code>）`)
  expect(body).not.toContain('再開すると公開')
})
