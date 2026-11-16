import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedDeck,
  seedDeployment,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { HOSTS_PER_DEPLOYMENT, listHosts } from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await signIn(env)
})
afterAll(() => platform.dispose())

const originOf = (id: string) => `https://d-${id}.content.example`

/** Posts what a browser posts when a slide reaches for `blocked`. */
const send = (id: string, body: string, init: RequestInit = {}) =>
  server.fetch(
    new Request(`${originOf(id)}/_preview/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/csp-report' },
      body,
      ...init,
    }),
    env,
  )
const reportOf = (blocked: string) =>
  JSON.stringify({ 'csp-report': { 'blocked-uri': blocked } })

test('Given public slides, When browsers report hosts they reached, Then each host is kept once and the viewer lists them', async () => {
  const id = await seedPublic(db, 'talk', 1, 'Talk')
  for (const blocked of [
    'https://images.elsewhere.example/a.png',
    'https://api.elsewhere.example/v1',
    'https://images.elsewhere.example/b.png',
  ])
    expect((await send(id, reportOf(blocked))).status).toBe(204)
  expect(await listHosts(db, id)).toEqual([
    'api.elsewhere.example',
    'images.elsewhere.example',
  ])
  const page = await (
    await server.fetch(new Request(`${TEST_ORIGIN}/@owner/talk`), env)
  ).text()
  expect(page).toContain('<code>api.elsewhere.example</code>')
  expect(page).toContain('<code>images.elsewhere.example</code>')
  expect(page).not.toContain('外部との通信は、まだ報告されていません。')
})

test('Given public slides nobody reported, When the viewer opens, Then it lists what the browser stops and says no host was reported', async () => {
  await seedPublic(db, 'talk', 1, 'Talk')
  const page = await (
    await server.fetch(new Request(`${TEST_ORIGIN}/@owner/talk`), env)
  ).text()
  expect(page).toContain('別のタブやウィンドウを開く')
  expect(page).toContain('外部との通信は、まだ報告されていません。')
  const english = await (
    await server.fetch(new Request(`${TEST_ORIGIN}/@owner/talk?lang=en`), env)
  ).text()
  expect(english).toContain('Opening other tabs or windows')
  expect(english).toContain('No other site has been reported yet.')
})

test('Given a host spelled as markup, When reported, Then nothing is kept', async () => {
  const id = await seedPublic(db, 'talk', 1, 'Talk')
  await send(id, reportOf('https://<script>alert(1)</script>.example/'))
  expect(await listHosts(db, id)).toEqual([])
})

test.each([
  ['a body that is not JSON', 'not json'],
  ['an empty body', ''],
  ['an inline violation', reportOf('inline')],
  [
    'a body larger than a report',
    reportOf(`https://a.example/${'a'.repeat(9000)}`),
  ],
])(
  'Given public slides, When %s is posted, Then it is answered alike and nothing is kept',
  async (_, body) => {
    const id = await seedPublic(db, 'talk', 1, 'Talk')
    expect((await send(id, body)).status).toBe(204)
    expect(await listHosts(db, id)).toEqual([])
  },
)

test('Given public slides, When they report their own host, Then nothing is kept', async () => {
  const id = await seedPublic(db, 'talk', 1, 'Talk')
  await send(id, reportOf(`${originOf(id)}/img/dot.svg`))
  expect(await listHosts(db, id)).toEqual([])
})

test('Given a draft, When someone without the author’s session reports a host, Then it is answered like any report and nothing is kept', async () => {
  await seedDeck(db, 'talk')
  const id = await seedDeployment(db, 'talk')
  expect((await send(id, reportOf('https://a.example/'))).status).toBe(204)
  expect(await listHosts(db, id)).toEqual([])
})

test('Given no such deployment, When a host is reported, Then it is answered like any report and nothing is kept', async () => {
  const id = crypto.randomUUID()
  expect((await send(id, reportOf('https://a.example/'))).status).toBe(204)
  expect(await listHosts(db, id)).toEqual([])
})

test('Given slides at their bound of hosts, When more are reported, Then the first ones stay and a known host is still accepted', async () => {
  const id = await seedPublic(db, 'talk', 1, 'Talk')
  for (let index = 0; index < HOSTS_PER_DEPLOYMENT + 5; index++)
    await send(
      id,
      reportOf(`https://h${String(index).padStart(2, '0')}.example/`),
    )
  const hosts = await listHosts(db, id)
  expect(hosts).toHaveLength(HOSTS_PER_DEPLOYMENT)
  expect(hosts.at(-1)).toBe(`h${HOSTS_PER_DEPLOYMENT - 1}.example`)
  expect((await send(id, reportOf('https://h00.example/'))).status).toBe(204)
  expect(await listHosts(db, id)).toHaveLength(HOSTS_PER_DEPLOYMENT)
})

test('Given hosts reported at once, When they pass the bound together, Then no more than the bound are kept', async () => {
  const id = await seedPublic(db, 'talk', 1, 'Talk')
  await Promise.all(
    Array.from({ length: HOSTS_PER_DEPLOYMENT * 2 }, (_, index) =>
      send(id, reportOf(`https://p${index}.example/`)),
    ),
  )
  expect(await listHosts(db, id)).toHaveLength(HOSTS_PER_DEPLOYMENT)
})
