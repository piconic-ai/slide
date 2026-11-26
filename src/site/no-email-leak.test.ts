import { createHash } from 'node:crypto'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { CRON_TASKS, runScheduled } from '../app/cron-routes'
import { ALERT_URGENCY, noticeOf, runbookLink } from '../alerts/notice'
import type { AlertKind } from '../alerts/notice'
import { cronFailedNotice, maintenanceNotice } from '../alerts/notice'
import { notifierOf } from '../alerts/notify-routes'
import { HELP_CATALOG } from '../help/default-catalog'
import { ACCESS_TOKEN_HEADER } from '../operator/access'
import {
  accessTeam,
  AUDIENCE,
  OPERATOR_ORIGIN,
  TEAM,
} from '../operator/test-support'
import { signIn } from '../publication/test-support'
import { applyMigrations } from '../db/test-migrations'
import { gravatarHash } from '../profile/gravatar'
import { callTool, connectAgent, mcpClient } from '../mcp/test-connect'
import { emailOf, TEST_ORIGIN, testEnv } from '../publication/test-support'
import { seedIntegration } from './test-integration'

const team = await accessTeam()
vi.mock('../operator/access-client', () => ({ accessKeys: () => team.keys }))

const platform = await getPlatformProxy<Env>({ persist: false })
// The counts and the Worker's origins are taken over by the test: what is
// written to the dataset is kept to be read.
const written: unknown[] = []
const env = {
  ...testEnv(platform.env),
  OPERATOR_ORIGIN,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUDIENCE,
  ANALYTICS: { writeDataPoint: (point: unknown) => written.push(point) },
} as unknown as Env
let owner = ''
let bob = ''

beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  ;({ owner, bob } = await seedIntegration(env))
})
afterAll(() => platform.dispose())
afterEach(() => vi.restoreAllMocks())

/**
 * What must never appear: each address as typed and as it is stored, and its
 * MD5 and SHA-256 in hexadecimal (what Gravatar and other services take an
 * address by), however the address is spelled.
 */
async function secretsOf(logins: readonly string[]) {
  const found: Array<[string, string]> = []
  for (const login of logins) {
    const email = emailOf(login)
    for (const spelled of [email, email.toUpperCase()]) {
      found.push([`${login} address`, spelled.toLowerCase()])
      for (const form of [spelled, spelled.toLowerCase()]) {
        found.push([
          `${login} md5`,
          createHash('md5').update(form).digest('hex'),
        ])
        found.push([
          `${login} sha256`,
          createHash('sha256').update(form).digest('hex'),
        ])
      }
    }
    found.push([`${login} gravatar hash`, await gravatarHash(email)])
    // The local part with the mail domain, wherever it is put.
    found.push([`${login} domain`, '@mail.example'])
  }
  return found
}

const forbidden = await secretsOf(['owner', 'bob'])

function expectNoSecrets(
  label: string,
  body: string,
  secrets: readonly (readonly [string, string])[] = forbidden,
) {
  const text = body.toLowerCase()
  for (const [what, secret] of secrets)
    expect(text.includes(secret.toLowerCase()), `${label} shows ${what}`).toBe(
      false,
    )
}

const get = (path: string, cookie: string) =>
  server.fetch(
    new Request(new URL(path, TEST_ORIGIN), {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    env,
  )

// Every page and public answer a signed-in author or a reader meets, but the
// settings page, which shows its owner their own address (F28-AC54), and the
// operator's list of invitations, which holds the addresses by design.
const paths = [
  '/',
  '/login',
  '/help',
  '/terms',
  '/privacy',
  '/contact',
  '/my/slides',
  '/my/slides/talk',
  '/my/slides/talk/article',
  '/notifications',
  '/@owner',
  '/@owner/cited',
  '/@owner/citing',
  '/@owner/following',
  '/@owner/followers',
  '/@owner/talk',
  '/@owner/talk/1',
  '/@bob',
  '/@bob/cited',
  '/@bob/reply',
  '/embed/@owner/talk',
  `/oembed?url=${encodeURIComponent(`${TEST_ORIGIN}/@owner/talk`)}`,
  '/api/home',
  '/api/session',
  '/api/public/slides',
  '/api/slides',
  '/avatars/722500',
  '/avatars/1234',
  '/.well-known/oauth-authorization-server',
]

test.each(['owner', 'bob', 'a reader who is not signed in'])(
  'F28-AC54: Given %s, When they open every page and public answer but the settings, Then neither any address nor its MD5 or SHA-256 is in a body or a header',
  async (who) => {
    const cookie = who === 'owner' ? owner : who === 'bob' ? bob : ''
    let successful = 0
    for (const path of paths) {
      const response = await get(path, cookie)
      if (response.status === 200) successful++
      const headers = [...response.headers]
        .map(([name, value]) => `${name}: ${value}`)
        .join('\n')
      expectNoSecrets(`${path} headers`, headers)
      const type = response.headers.get('Content-Type') ?? ''
      if (/^image\//.test(type)) {
        await response.arrayBuffer()
        continue
      }
      expectNoSecrets(path, await response.text())
    }
    if (who === 'owner') expect(successful).toBeGreaterThan(paths.length * 0.8)
  },
  15_000,
)

test('F28-AC54: Given the settings page, When its owner opens it, Then it is the one page that shows their own address', async () => {
  const body = await (await get('/settings', owner)).text()
  expect(body).toContain(emailOf('owner'))
  expect(body).not.toContain(emailOf('bob'))
})

test('F35-AC32: Given a connected agent, When it calls export_account, Then the author’s own address is in the account file, and no other address or hash is', async () => {
  const { tokens } = await connectAgent(env, owner, 'Exporting agent')
  const client = await mcpClient(env, tokens.access_token)
  const answer = JSON.stringify(await callTool(client, 'export_account'))
  expect(answer).toContain(emailOf('owner'))
  expect(answer).not.toContain(emailOf('bob'))
  await client.close()
})

test('F28-AC54: Given a connected agent, When it calls the tools, Then no answer holds an address or its hash', async () => {
  const { tokens } = await connectAgent(env, owner, 'Agent')
  const client = await mcpClient(env, tokens.access_token)
  const answers = [
    await client.listTools(),
    await callTool(client, 'list_slides'),
    await callTool(client, 'get_status', { slide: 'talk' }),
    client.getInstructions() ?? '',
  ]
  expectNoSecrets('mcp', JSON.stringify(answers))
  await client.close()
})

// The fourth scope's places an address could leak to: the pages it added, the
// exports (which hold only what is the author's own), the counts, the logs, the
// notices and the operator's pages.

const SCOPE4_PATHS = [
  '/privacy/external',
  '/help/bot',
  '/help?q=zzzz-no-such-word',
  ...HELP_CATALOG.map((entry) => entry.path),
  '/my/slides/talk/export/slide.json',
  '/my/slides/talk/export/article.md',
]

test('F28-AC54: Given the pages of the fourth scope, When a signed-in author opens them, Then neither any address nor its hash is in a body or a header', async () => {
  for (const path of SCOPE4_PATHS) {
    const response = await get(path, owner)
    expect([200, 404], path).toContain(response.status)
    const headers = [...response.headers]
      .map(([name, value]) => `${name}: ${value}`)
      .join('\n')
    expectNoSecrets(`${path} headers`, headers)
    expectNoSecrets(path, await response.text())
  }
})

// Walks every page as three people, slower than the default timeout on a busy runner.
test('F40-AC15: Given the pages of the service opened by each person, When the counts written are read, Then not one holds an address or its hash', async () => {
  written.length = 0
  for (const cookie of [owner, bob, ''])
    for (const path of [...paths, ...SCOPE4_PATHS])
      await (await get(path, cookie)).arrayBuffer()
  expect(written.length).toBeGreaterThan(5)
  expectNoSecrets('counts', JSON.stringify(written))
}, 30_000)

const WEBHOOK =
  'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwx'

test('F39-AC9: Given the service run through sign-in, errors, every cron task and every kind of alert, When what it logged and sent is read, Then no address, no hash and no person’s name is in it', async () => {
  const lines: string[] = []
  vi.spyOn(console, 'log').mockImplementation((text) =>
    lines.push(String(text)),
  )
  vi.spyOn(console, 'error').mockImplementation((text) =>
    lines.push(String(text)),
  )
  const sent: string[] = []
  const send = (async (_url: unknown, init?: RequestInit) => {
    sent.push(String(init?.body))
    return new Response(null, { status: 204 })
  }) as typeof fetch
  const live = { ...env, DISCORD_WEBHOOK_URL: WEBHOOK } as unknown as Env
  // A sign-in, one that is refused, and a page that is not there.
  await signIn(env, 'dave', { id: '5555' })
  await signIn(env, 'erin', { id: '6666', invited: false })
  await get('/@nobody/none', owner)
  await get('/my/slides/none/export/slide.json', owner)
  await get('/mcp/files/none', '')
  // Every cron task at every hour, with the webhook set.
  for (let hour = 0; hour < 24; hour += 1) {
    const waited: Promise<unknown>[] = []
    runScheduled(
      CRON_TASKS,
      {
        scheduledTime: Date.UTC(2026, 10, 26, hour, 17),
        cron: '17 * * * *',
        noRetry() {},
      },
      live,
      {
        waitUntil: (promise: Promise<unknown>) => waited.push(promise),
        passThroughOnException() {},
        props: {},
      } as unknown as ExecutionContext,
      notifierOf(live, { send }),
    )
    await Promise.all(waited)
  }
  // Every kind of alert, at once or the next day.
  const notifier = notifierOf(live, { send })
  for (const kind of Object.keys(ALERT_URGENCY) as AlertKind[])
    await notifier(
      kind === 'cron_failed'
        ? cronFailedNotice('backup', 2, runbookLink(kind))
        : kind === 'maintenance'
          ? maintenanceNotice('started', 2, runbookLink(kind))
          : noticeOf(kind, 2, runbookLink(kind)),
    )
  expect(sent.length).toBeGreaterThan(3)
  const people = await secretsOf(['owner', 'bob', 'dave', 'erin'])
  expectNoSecrets('logs', lines.join('\n'), people)
  expectNoSecrets('webhook bodies', sent.join('\n'), people)
  // Nor a person's display name, which is no one else's to read in a log.
  for (const name of ['Owner Name', 'Bob Builder'])
    expect(lines.join('\n') + sent.join('\n')).not.toContain(name)
}, 30_000)

test('F40-AC15: Given the operator’s pages, When an operator opens them, Then the invitations and the people are not named in them', async () => {
  for (const path of ['/operations', '/metrics', '/metrics.csv']) {
    const response = await server.fetch(
      new Request(`${OPERATOR_ORIGIN}${path}`, {
        headers: { [ACCESS_TOKEN_HEADER]: await team.sign() },
      }),
      env,
    )
    expect(response.status, path).toBe(200)
    expectNoSecrets(path, await response.text())
  }
})
