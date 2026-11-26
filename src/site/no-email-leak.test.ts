import { createHash } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { gravatarHash } from '../profile/gravatar'
import { callTool, connectAgent, mcpClient } from '../mcp/test-connect'
import { emailOf, TEST_ORIGIN, testEnv } from '../publication/test-support'
import { seedIntegration } from './test-integration'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env) as unknown as Env
let owner = ''
let bob = ''

beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  ;({ owner, bob } = await seedIntegration(env))
})
afterAll(() => platform.dispose())

/**
 * What must never appear: each address as typed and as it is stored, and its
 * MD5 and SHA-256 in hexadecimal (what Gravatar and other services take an
 * address by), however the address is spelled.
 */
async function secrets() {
  const found: Array<[string, string]> = []
  for (const login of ['owner', 'bob']) {
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

const forbidden = await secrets()

function expectNoSecrets(label: string, body: string) {
  const text = body.toLowerCase()
  for (const [what, secret] of forbidden)
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
  '/slides',
  '/slides/talk',
  '/slides/talk/article',
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
