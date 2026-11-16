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
import { HOSTS_SHOWN, listHosts, recordHost } from './store'

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
      headers: {
        'Content-Type': 'application/csp-report',
        'Content-Length': String(new TextEncoder().encode(body).length),
      },
      body,
      ...init,
    }),
    env,
  )
/** The hosts a viewer would list, in a fixed order. */
const shownHosts = async (id: string) =>
  [...(await listHosts(db, id)).shown].sort()
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
  expect(await shownHosts(id)).toEqual([
    'api.elsewhere.example',
    'images.elsewhere.example',
  ])
  const page = await (
    await server.fetch(new Request(`${TEST_ORIGIN}/@owner/talk`), env)
  ).text()
  expect(page).toContain('<code>api.elsewhere.example</code>')
  expect(page).toContain('<code>images.elsewhere.example</code>')
  expect(page).toContain('<p data-hosts-none hidden>')
  expect(page).toContain('<p data-hosts-more hidden>')
  expect(page).toContain(`data-hosts="/api/public/deployments/${id}/hosts"`)
})

test('Given public slides nobody reported, When the viewer opens, Then it lists what the browser stops and says no host was reported', async () => {
  await seedPublic(db, 'talk', 1, 'Talk')
  const page = await (
    await server.fetch(new Request(`${TEST_ORIGIN}/@owner/talk`), env)
  ).text()
  expect(page).toContain('別のタブやウィンドウを開く')
  expect(page).toContain(
    '<p data-hosts-none >外部との通信は、まだ報告されていません。',
  )
  expect(page).toContain('<ul class="hosts" hidden>')
  const english = await (
    await server.fetch(new Request(`${TEST_ORIGIN}/@owner/talk?lang=en`), env)
  ).text()
  expect(english).toContain('Opening other tabs or windows')
  expect(english).toContain('No other site has been reported yet.')
})

test('Given a host spelled as markup, When reported, Then nothing is kept', async () => {
  const id = await seedPublic(db, 'talk', 1, 'Talk')
  await send(id, reportOf('https://<script>alert(1)</script>.example/'))
  expect(await shownHosts(id)).toEqual([])
})

test.each([
  ['a body that is not JSON', 'not json'],
  ['an empty body', ''],
  ['an inline violation', reportOf('inline')],
  [
    'a blocked URL longer than a report holds',
    reportOf(`https://a.example/${'a'.repeat(5000)}`),
  ],
])(
  'Given public slides, When %s is posted, Then it is answered alike and nothing is kept',
  async (_, body) => {
    const id = await seedPublic(db, 'talk', 1, 'Talk')
    expect((await send(id, body)).status).toBe(204)
    expect(await shownHosts(id)).toEqual([])
  },
)

test('Given public slides, When they report their own host, Then nothing is kept', async () => {
  const id = await seedPublic(db, 'talk', 1, 'Talk')
  await send(id, reportOf(`${originOf(id)}/img/dot.svg`))
  expect(await shownHosts(id)).toEqual([])
})

test('Given a draft, When someone without the author’s session reports a host, Then it is answered like any report and nothing is kept', async () => {
  await seedDeck(db, 'talk')
  const id = await seedDeployment(db, 'talk')
  expect((await send(id, reportOf('https://a.example/'))).status).toBe(204)
  expect(await shownHosts(id)).toEqual([])
})

test('Given no such deployment, When a host is reported, Then it is answered like any report and nothing is kept', async () => {
  const id = crypto.randomUUID()
  expect((await send(id, reportOf('https://a.example/'))).status).toBe(204)
  expect(await shownHosts(id)).toEqual([])
})

test('Given slides whose list was filled first, When one more host is reported, Then the list stays and the viewer says more were reported', async () => {
  const id = await seedPublic(db, 'talk', 1, 'Talk')
  for (let index = 0; index < HOSTS_SHOWN; index++)
    await send(
      id,
      reportOf(`https://h${String(index).padStart(2, '0')}.example/`),
    )
  const view = async () =>
    (await server.fetch(new Request(`${TEST_ORIGIN}/@owner/talk`), env)).text()
  expect(await view()).toContain('<p data-hosts-more hidden>')
  await send(id, reportOf('https://late.example/'))
  await send(id, reportOf('https://later.example/'))
  const hosts = await listHosts(db, id)
  expect(hosts.shown).toHaveLength(HOSTS_SHOWN)
  expect(hosts.shown).not.toContain('late.example')
  expect(hosts.more).toBe(true)
  const page = await view()
  expect(page).toContain(
    '<p data-hosts-more >このほかにも通信先が報告されています。',
  )
  expect(page).not.toContain('late.example')
})

test('Given hosts reported at once, When they pass the bound together, Then one past the shown bound is kept and no more', async () => {
  const id = await seedPublic(db, 'talk', 1, 'Talk')
  await Promise.all(
    Array.from({ length: HOSTS_SHOWN * 2 }, (_, index) =>
      send(id, reportOf(`https://p${index}.example/`)),
    ),
  )
  const kept = await db
    .prepare(
      'SELECT count(*) AS n FROM deployment_hosts WHERE deployment_id = ?',
    )
    .bind(id)
    .first<{ n: number }>()
  expect(kept?.n).toBe(HOSTS_SHOWN + 1)
})

test.each([
  [
    'larger than a report',
    (body: string) => ({ 'Content-Length': String(body.length) }),
  ],
  ['of no declared size', () => ({})],
  ['of a size that is not a number', () => ({ 'Content-Length': 'many' })],
])(
  'Given public slides, When a report with a small blocked URL arrives in a body %s, Then nothing is kept',
  async (_, lengthOf) => {
    const id = await seedPublic(db, 'talk', 1, 'Talk')
    const body = JSON.stringify({
      'csp-report': {
        'blocked-uri': 'https://a.example/',
        padding: 'a'.repeat(9000),
      },
    })
    const response = await send(id, body, {
      headers: { 'Content-Type': 'application/csp-report', ...lengthOf(body) },
    })
    expect(response.status).toBe(204)
    expect(await shownHosts(id)).toEqual([])
  },
)

const readHosts = (id: string) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/api/public/deployments/${id}/hosts`),
    env,
  )

test('Given public slides with reported hosts, When the viewer asks for them again, Then it gets the list as the page would show it, uncached', async () => {
  const id = await seedPublic(db, 'talk', 1, 'Talk')
  await send(id, reportOf('https://a.example/'))
  const response = await readHosts(id)
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toEqual({ shown: ['a.example'], more: false })
})

test('Given a draft with a host its author’s browser reported, When anyone asks for its hosts, Then it answers like a missing version', async () => {
  await seedDeck(db, 'talk')
  const draft = await seedDeployment(db, 'talk')
  await recordHost(db, { deploymentId: draft, host: 'a.example', now: 1 })
  for (const id of [draft, crypto.randomUUID(), 'not-an-id']) {
    const response = await readHosts(id)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
  }
})
