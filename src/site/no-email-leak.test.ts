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

async function expectNoSecrets(label: string, body: string) {
  const text = body.toLowerCase()
  for (const [what, secret] of await secrets())
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
    for (const path of paths) {
      const response = await get(path, cookie)
      const headers = [...response.headers]
        .map(([name, value]) => `${name}: ${value}`)
        .join('\n')
      await expectNoSecrets(`${path} headers`, headers)
      const type = response.headers.get('Content-Type') ?? ''
      if (/^image\//.test(type)) {
        await response.arrayBuffer()
        continue
      }
      await expectNoSecrets(path, await response.text())
    }
  },
)

test('F28-AC54: Given the pages are fetched, When they are counted, Then a majority answered with a body and not an error that shows nothing', async () => {
  let pages = 0
  for (const path of paths)
    if ((await get(path, owner)).status === 200) pages += 1
  expect(pages).toBeGreaterThan(paths.length * 0.8)
})

test('F28-AC54: Given the settings page, When its owner opens it, Then it is the one page that shows their own address', async () => {
  const body = await (await get('/settings', owner)).text()
  expect(body).toContain(emailOf('owner'))
  expect(body).not.toContain(emailOf('bob'))
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
  await expectNoSecrets('mcp', JSON.stringify(answers))
  await client.close()
})
