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
import {
  listTraffic,
  recordTraffic,
  TRAFFIC_KEPT,
  TRAFFIC_KEPT_PER_GROUP,
  TRAFFIC_PER_REQUEST,
} from './store'

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
/** The hosts kept for a deployment, in a fixed order. */
const keptHosts = async (id: string) =>
  [...new Set((await listTraffic(db, id)).map((item) => item.host))].sort()
const reportOf = (blocked: string, directive = 'img-src') =>
  JSON.stringify({
    'csp-report': { 'blocked-uri': blocked, 'effective-directive': directive },
  })
const readTable = (id: string, query = '') =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/api/public/deployments/${id}/traffic${query}`),
    env,
  )
const tableOf = async (id: string, query = '') =>
  (await (await readTable(id, query)).text()).replace(/\s+/g, ' ')

test('Given public slides, When browsers report what they reached, Then each is kept once with its kind and path, without the query', async () => {
  const id = await seedPublic(db, 'talk', 1, 'Talk')
  for (const [blocked, directive] of [
    ['https://images.elsewhere.example/a.png?size=2', 'img-src'],
    ['https://api.elsewhere.example/v1/zen?token=secret', 'connect-src'],
    ['https://images.elsewhere.example/a.png?size=3', 'img-src'],
  ])
    expect((await send(id, reportOf(blocked!, directive))).status).toBe(204)
  expect(await listTraffic(db, id)).toEqual([
    { kind: 'data', host: 'api.elsewhere.example', path: '/v1/zen', page: -1 },
    {
      kind: 'image',
      host: 'images.elsewhere.example',
      path: '/a.png',
      page: -1,
    },
  ])
})

test('Given public slides with reports, When the viewer asks for the table, Then it gets the facts in the reader’s language, uncached, with no mark on any row', async () => {
  const id = await seedPublic(db, 'talk', 1, 'Talk')
  await send(id, reportOf('https://images.elsewhere.example/a.png', 'img-src'))
  await send(id, reportOf('https://images.elsewhere.example/b.png', 'img-src'))
  await send(id, reportOf('https://api.elsewhere.example/v1', 'connect-src'))
  const response = await readTable(id)
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store, no-transform')
  const table = await tableOf(id)
  expect(table).toContain('<th scope="col">ページ</th>')
  expect(table).toContain(
    '<td>不明</td> <td>画像の読み込み</td> <td> <code>images.elsewhere.example/a.png</code> ほか 1 件 </td>',
  )
  expect(table).toContain(
    '<td>不明</td> <td>データの送受信</td> <td> <code>api.elsewhere.example/v1</code> </td>',
  )
  expect(table).not.toContain('このほかにも報告されています。')
  const english = await tableOf(id, '?lang=en')
  expect(english).toContain('<td>Loads an image</td>')
  expect(english).toContain('and 1 more')
})

test('Given records with pages, When the table is read, Then each row tells its pages, and what happened on opening reads as the whole', async () => {
  const id = await seedPublic(db, 'talk', 1, 'Talk')
  await recordTraffic(db, {
    deploymentId: id,
    now: 1,
    traffic: [
      { kind: 'font', host: 'fonts.example', path: '/a.woff2', page: 0 },
      { kind: 'data', host: 'api.example', path: '/v1', page: 8 },
      { kind: 'data', host: 'api.example', path: '/v1', page: 5 },
    ],
  })
  const table = await tableOf(id)
  expect(table).toContain('<td>全体</td> <td>フォントの読み込み</td>')
  expect(table).toContain('<td>5, 8</td> <td>データの送受信</td>')
})

test('Given public slides nobody reported, When the viewer opens, Then nothing about traffic is on the page until the table is opened, and the table says none was reported', async () => {
  const id = await seedPublic(db, 'talk', 1, 'Talk')
  const page = await (
    await server.fetch(new Request(`${TEST_ORIGIN}/@owner/talk`), env)
  ).text()
  expect(page).toContain(
    `data-traffic="/api/public/deployments/${id}/traffic?lang=ja"`,
  )
  expect(page).toContain('<div data-traffic-table></div>')
  expect(page).toMatch(
    /<a href="\/help#traffic" target="_blank" rel="noopener"\s*>この表の読み方<\/a\s*>/,
  )
  expect(page).not.toContain('別のタブやウィンドウを開く')
  expect(await tableOf(id)).toBe(
    '<p>外部との通信は、まだ報告されていません。</p>',
  )
  expect(await tableOf(id, '?lang=en')).toBe(
    '<p>No traffic to other sites has been reported yet.</p>',
  )
})

test('Given a host spelled as markup, When reported, Then nothing is kept', async () => {
  const id = await seedPublic(db, 'talk', 1, 'Talk')
  await send(id, reportOf('https://<script>alert(1)</script>.example/'))
  expect(await keptHosts(id)).toEqual([])
})

test('Given a path spelled as markup, When reported, Then the table shows it as text', async () => {
  const id = await seedPublic(db, 'talk', 1, 'Talk')
  await send(id, reportOf("https://a.example/<img src=x onerror=alert(1)>/'"))
  const table = await tableOf(id)
  expect(table).not.toContain('<img')
  expect(table).toContain(
    '<code>a.example/%3Cimg%20src=x%20onerror=alert(1)%3E/&#39;</code>',
  )
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
    expect(await keptHosts(id)).toEqual([])
  },
)

test('Given public slides, When they report their own host or Slide itself, Then nothing is kept', async () => {
  const id = await seedPublic(db, 'talk', 1, 'Talk')
  await send(id, reportOf(`${originOf(id)}/img/dot.svg`))
  await send(id, reportOf(`${TEST_ORIGIN}/api/slides`, 'connect-src'))
  expect(await keptHosts(id)).toEqual([])
})

test('Given a draft, When someone without the author’s session reports, Then it is answered like any report and nothing is kept', async () => {
  await seedDeck(db, 'talk')
  const id = await seedDeployment(db, 'talk')
  expect((await send(id, reportOf('https://a.example/'))).status).toBe(204)
  expect(await keptHosts(id)).toEqual([])
})

test('Given no such deployment, When something is reported, Then it is answered like any report and nothing is kept', async () => {
  const id = crypto.randomUUID()
  expect((await send(id, reportOf('https://a.example/'))).status).toBe(204)
  expect(await keptHosts(id)).toEqual([])
})

const countKept = async (id: string) =>
  (
    await db
      .prepare(
        'SELECT count(*) AS n FROM deployment_traffic WHERE deployment_id = ?',
      )
      .bind(id)
      .first<{ n: number }>()
  )?.n
const filesOf = (host: string, count: number, from = 0) =>
  Array.from({ length: count }, (_, index) => ({
    kind: 'font' as const,
    host,
    path: `/${from + index}.woff2`,
    page: 0,
  }))
/** Records in as many requests as it takes. */
const record = async (id: string, traffic: ReturnType<typeof filesOf>) => {
  for (let at = 0; at < traffic.length; at += TRAFFIC_PER_REQUEST)
    await recordTraffic(db, {
      deploymentId: id,
      now: 1,
      traffic: traffic.slice(at, at + TRAFFIC_PER_REQUEST),
    })
}

test('Given one host sending more files than its share, When another host is reported later, Then the later host is still kept and the full row says its count is a lower bound', async () => {
  const id = await seedPublic(db, 'talk', 1, 'Talk')
  await record(id, filesOf('fonts.example', TRAFFIC_KEPT_PER_GROUP + 20))
  expect(await countKept(id)).toBe(TRAFFIC_KEPT_PER_GROUP)
  await send(id, reportOf('https://api.late.example/v1', 'connect-src'))
  expect(await keptHosts(id)).toEqual(['api.late.example', 'fonts.example'])
  const table = await tableOf(id)
  expect(table).toContain(`ほか ${TRAFFIC_KEPT_PER_GROUP - 1} 件以上`)
  expect(table).toContain('<code>api.late.example/v1</code>')
})

test('Given a deployment whose records were filled first, When one more is reported, Then it is not kept and the table says more was reported', async () => {
  const id = await seedPublic(db, 'talk', 1, 'Talk')
  const perHost = TRAFFIC_KEPT_PER_GROUP
  for (let host = 0; host * perHost < TRAFFIC_KEPT; host++)
    await record(id, filesOf(`h${host}.example`, perHost))
  expect(await countKept(id)).toBe(TRAFFIC_KEPT)
  await send(id, reportOf('https://late.example/'))
  expect(await keptHosts(id)).not.toContain('late.example')
  expect(await tableOf(id)).toContain('<p>このほかにも報告されています。</p>')
}, 30000)

test('Given reports arriving at once, When they pass a bound together, Then no more than the bound is kept', async () => {
  const id = await seedPublic(db, 'talk', 1, 'Talk')
  await record(id, filesOf('fonts.example', TRAFFIC_KEPT_PER_GROUP - 5))
  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      send(id, reportOf(`https://fonts.example/late-${index}`, 'font-src')),
    ),
  )
  expect(await countKept(id)).toBe(TRAFFIC_KEPT_PER_GROUP)
})

test('Given more records in one request than a request may carry, When recorded, Then only the first are kept', async () => {
  const id = await seedPublic(db, 'talk', 1, 'Talk')
  await recordTraffic(db, {
    deploymentId: id,
    now: 1,
    traffic: filesOf('fonts.example', TRAFFIC_PER_REQUEST + 10),
  })
  expect(await countKept(id)).toBe(TRAFFIC_PER_REQUEST)
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
    expect(await keptHosts(id)).toEqual([])
  },
)

test('Given a draft with traffic its author’s browser reported, When anyone asks for its table, Then it answers like a missing version', async () => {
  await seedDeck(db, 'talk')
  const draft = await seedDeployment(db, 'talk')
  await recordTraffic(db, {
    deploymentId: draft,
    now: 1,
    traffic: [{ kind: 'image', host: 'a.example', path: '/', page: -1 }],
  })
  for (const id of [draft, crypto.randomUUID(), 'not-an-id']) {
    const response = await readTable(id)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
  }
})
