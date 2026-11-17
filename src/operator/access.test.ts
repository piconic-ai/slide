import { generateKeyPair } from 'jose'
import { expect, test } from 'vitest'
import { verifyAccessToken } from './access'
import { accessTeam, AUDIENCE, TEAM } from './test-support'

const team = await accessTeam()
const access = { issuer: TEAM, audience: AUDIENCE }
const now = Math.floor(Date.now() / 1000)
const verify = (token: string | undefined, at = now) =>
  verifyAccessToken(token, access, team.keys, at)

test('F17-AC12: Given a token Access signed for this application, When it is verified, Then the operator is the person it names', async () => {
  expect(await verify(await team.sign())).toEqual({
    kind: 'operator',
    operator: { email: 'op@example.com' },
  })
})

test('F17-AC12: Given no token, When a request is verified, Then it is denied', async () => {
  expect(await verify(undefined)).toEqual({
    kind: 'denied',
    reason: 'no_token',
  })
  expect((await verify('')).kind).toBe('denied')
  expect((await verify('not.a.token')).kind).toBe('denied')
})

test('F17-AC12: Given a token signed with another key, When it is verified, Then it is denied', async () => {
  const other = await generateKeyPair('RS256')
  const token = await team.sign({}, { key: other.privateKey })
  expect((await verify(token)).kind).toBe('denied')
})

test('F17-AC12: Given a token for another application, When it is verified, Then it is denied', async () => {
  expect((await verify(await team.sign({ aud: 'b'.repeat(64) }))).kind).toBe(
    'denied',
  )
})

test('F17-AC12: Given a token from another team, When it is verified, Then it is denied', async () => {
  const token = await team.sign({ iss: 'https://other.cloudflareaccess.com' })
  expect((await verify(token)).kind).toBe('denied')
})

test('F17-AC12: Given an expired token, When it is verified, Then it is denied, and one about to expire still passes', async () => {
  const token = await team.sign({}, { expiresAt: now + 60 })
  expect((await verify(token, now + 59)).kind).toBe('operator')
  expect((await verify(token, now + 61)).kind).toBe('denied')
})

test.each([
  ['no email', { email: undefined }],
  ['an email that is not one', { email: 'operator' }],
  ['an email that is not a string', { email: 1 }],
])(
  'F17-AC12: Given a valid token with %s, When it is verified, Then it is denied, because nobody could be recorded',
  async (_, claims) => {
    expect(await verify(await team.sign(claims))).toEqual({
      kind: 'denied',
      reason: 'no_email',
    })
  },
)

test('F17-AC12: Given a token whose header claims no signature, When it is verified, Then it is denied', async () => {
  const [, payload] = (await team.sign()).split('.')
  const header = Buffer.from('{"alg":"none"}').toString('base64url')
  expect((await verify(`${header}.${payload}.`)).kind).toBe('denied')
})
