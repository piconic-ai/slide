import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedDeck,
  seedDeployment,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { recordTraffic } from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

beforeAll(() => applyMigrations(db))
beforeEach(() => resetTables(db))
afterAll(() => platform.dispose())

const read = (path: string, cookie?: string) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    env,
  )
const textOf = async (response: Response) =>
  (await response.text()).replace(/\s+/g, ' ')
/** A draft of the signed-in owner's deck, with one reported exchange. */
async function seedDraft() {
  await seedDeck(db, 'talk')
  const id = await seedDeployment(db, 'talk')
  await recordTraffic(db, {
    deploymentId: id,
    now: 1,
    traffic: [
      { kind: 'data', host: 'api.example', path: '/v1', page: 3 },
      { kind: 'font', host: 'fonts.gstatic.com', path: '/s/a.woff2', page: 0 },
    ],
  })
  return id
}

test('Given a draft with reported traffic, When its author opens the version’s table, Then they see what readers would, and it is not stored or indexed', async () => {
  const cookie = await signIn(env)
  const id = await seedDraft()
  const response = await read(`/slides/talk/deployments/${id}/traffic`, cookie)
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toContain('no-store')
  const page = await textOf(response)
  expect(page).toContain('<h1>外部との通信</h1>')
  expect(page).toContain(
    '<td>全体</td> <td>フォントの読み込み(Google Fonts)</td>',
  )
  expect(page).toContain(
    '<td>3</td> <td>データの送受信</td> <td> <code>api.example/v1</code> </td>',
  )
  expect(page).toContain('<a href="/help#traffic">この表の読み方</a>')
  expect(page).toContain('<a href="/slides/talk">スライドの管理に戻る</a>')
})

test('Given a ready version, When its author opens the deck’s history, Then the version links to its table', async () => {
  const cookie = await signIn(env)
  const id = await seedDraft()
  const page = await textOf(await read('/slides/talk', cookie))
  expect(page).toContain(`href="/slides/talk/deployments/${id}/traffic"`)
})

test('Given a draft, When someone who is not signed in asks for its table, Then they are asked to sign in and see nothing of it', async () => {
  const id = await seedDraft()
  const response = await read(`/slides/talk/deployments/${id}/traffic`)
  expect(response.status).toBe(401)
  expect(await response.text()).not.toContain('api.example')
})

test('Given a signed-in author, When they ask for a table that is not of a ready version of their own deck, Then it answers like a missing deck', async () => {
  const cookie = await signIn(env)
  const id = await seedDraft()
  await seedDeck(db, 'theirs', 'someone-else')
  const theirs = await seedDeployment(db, 'theirs')
  await seedDeck(db, 'mine')
  const failed = await seedDeployment(db, 'talk', 'failed')
  for (const path of [
    `/slides/theirs/deployments/${theirs}/traffic`,
    // Their version under a deck the author owns.
    `/slides/talk/deployments/${theirs}/traffic`,
    // The author's version under another of their decks.
    `/slides/mine/deployments/${id}/traffic`,
    `/slides/talk/deployments/${failed}/traffic`,
    `/slides/talk/deployments/${crypto.randomUUID()}/traffic`,
    '/slides/talk/deployments/not-an-id/traffic',
  ]) {
    const response = await read(path, cookie)
    expect(response.status, path).toBe(404)
    expect(await response.text()).not.toContain('api.example')
  }
})
