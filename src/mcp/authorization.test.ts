import { describe, expect, it } from 'vitest'
import {
  answerUrl,
  checkAuthorization,
  fieldsOf,
  hashToken,
  MAX_STATE_LENGTH,
  parseTokenRequest,
  verifiesChallenge,
} from './authorization'

const RESOURCE = 'https://slide.example/mcp'
const client = {
  id: 'mcp_1',
  name: 'Agent',
  redirectUris: ['https://agent.example/cb'],
}
const challenge = 'c'.repeat(43)
const fields = {
  response_type: 'code',
  client_id: 'mcp_1',
  redirect_uri: 'https://agent.example/cb',
  code_challenge: challenge,
  code_challenge_method: 'S256',
  state: 'abc',
}

describe('checkAuthorization', () => {
  it('Given a complete request, When it is checked, Then it is accepted with the client’s registered name', () => {
    expect(checkAuthorization(fields, client, RESOURCE)).toEqual({
      kind: 'ok',
      request: {
        clientId: 'mcp_1',
        clientName: 'Agent',
        redirectUri: 'https://agent.example/cb',
        codeChallenge: challenge,
        state: 'abc',
      },
    })
  })

  it('Given the server’s own resource and no state, When it is checked, Then it is accepted', () => {
    const { state: _, ...stateless } = fields
    expect(
      checkAuthorization(
        { ...stateless, resource: RESOURCE, scope: 'anything at all' },
        client,
        RESOURCE,
      ),
    ).toMatchObject({ kind: 'ok', request: { state: null } })
  })

  it('Given no such client, When it is checked, Then the answer goes nowhere', () => {
    expect(checkAuthorization(fields, null, RESOURCE)).toEqual({
      kind: 'untrusted',
      reason: 'unknown_client',
    })
  })

  it.each([
    ['no redirect URI', undefined],
    ['a redirect URI the client did not register', 'https://evil.example/cb'],
    ['the registered URI with a query added', 'https://agent.example/cb?x=1'],
  ])('Given %s, When it is checked, Then the answer goes nowhere', (_, uri) => {
    expect(
      checkAuthorization({ ...fields, redirect_uri: uri }, client, RESOURCE),
    ).toEqual({ kind: 'untrusted', reason: 'redirect_uri' })
  })

  it.each([
    [
      'the implicit grant',
      { response_type: 'token' },
      'unsupported_response_type',
    ],
    [
      'no response type',
      { response_type: undefined },
      'unsupported_response_type',
    ],
    ['no challenge', { code_challenge: undefined }, 'invalid_request'],
    [
      'a plain challenge',
      { code_challenge_method: 'plain' },
      'invalid_request',
    ],
    [
      'no challenge method',
      { code_challenge_method: undefined },
      'invalid_request',
    ],
    [
      'a challenge that is too short',
      { code_challenge: 'c'.repeat(42) },
      'invalid_request',
    ],
    [
      'a challenge with other characters',
      { code_challenge: `${'c'.repeat(42)}=` },
      'invalid_request',
    ],
    [
      'another server as the resource',
      { resource: 'https://other.example/mcp' },
      'invalid_target',
    ],
    [
      'the origin without the path as the resource',
      { resource: 'https://slide.example' },
      'invalid_target',
    ],
  ])(
    'Given %s, When it is checked, Then the client is told %s through its redirect URI',
    (_, change, error) => {
      expect(
        checkAuthorization({ ...fields, ...change }, client, RESOURCE),
      ).toEqual({
        kind: 'refused',
        redirectUri: 'https://agent.example/cb',
        state: 'abc',
        error,
      })
    },
  )

  it('Given a state longer than the limit, When it is checked, Then it is refused and the state is not echoed', () => {
    const state = 's'.repeat(MAX_STATE_LENGTH + 1)
    expect(checkAuthorization({ ...fields, state }, client, RESOURCE)).toEqual({
      kind: 'refused',
      redirectUri: 'https://agent.example/cb',
      state: null,
      error: 'invalid_request',
    })
    expect(
      checkAuthorization(
        { ...fields, state: 's'.repeat(MAX_STATE_LENGTH) },
        client,
        RESOURCE,
      ).kind,
    ).toBe('ok')
  })

  it('Given an accepted request, When its fields are carried and checked again, Then the same request comes back', () => {
    const first = checkAuthorization(fields, client, RESOURCE)
    if (first.kind !== 'ok') throw new Error('expected an accepted request')
    expect(
      checkAuthorization(fieldsOf(first.request), client, RESOURCE),
    ).toEqual(first)
  })
})

describe('answerUrl', () => {
  it('Given a redirect URI with a query, When a code is answered, Then the query is kept and code, state and issuer are added', () => {
    expect(
      answerUrl(
        'https://agent.example/cb?keep=1',
        { code: 'c0de' },
        'a b&c',
        'https://slide.example',
      ),
    ).toBe(
      'https://agent.example/cb?keep=1&code=c0de&state=a+b%26c&iss=https%3A%2F%2Fslide.example',
    )
  })

  it('Given no state, When an error is answered, Then no state is sent', () => {
    const url = new URL(
      answerUrl(
        'http://127.0.0.1:1/cb',
        { error: 'access_denied' },
        null,
        'https://slide.example',
      ),
    )
    expect(Object.fromEntries(url.searchParams)).toEqual({
      error: 'access_denied',
      iss: 'https://slide.example',
    })
  })
})

describe('verifiesChallenge', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
  // The example of RFC 7636, appendix B.
  const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

  it('Given the verifier of a challenge, When they are compared, Then they match', async () => {
    expect(await hashToken(verifier)).toBe(expected)
    expect(await verifiesChallenge(verifier, expected)).toBe(true)
  })

  it.each([
    ['another verifier', 'x'.repeat(43)],
    ['the challenge itself', expected],
    ['an empty verifier', ''],
    ['a verifier that is too short', 'short'],
    ['a verifier with a space', `${'x'.repeat(42)} `],
  ])(
    'Given %s, When they are compared, Then they do not match',
    async (_, value) => {
      expect(await verifiesChallenge(value, expected)).toBe(false)
    },
  )
})

describe('parseTokenRequest', () => {
  const exchange = {
    grant_type: 'authorization_code',
    code: 'c',
    client_id: 'mcp_1',
    redirect_uri: 'https://agent.example/cb',
    code_verifier: 'v',
  }

  it('Given a code exchange, When the form is read, Then its parts are named', () => {
    expect(
      parseTokenRequest({ ...exchange, resource: RESOURCE }, RESOURCE),
    ).toEqual({
      ok: true,
      request: {
        grant: 'authorization_code',
        code: 'c',
        clientId: 'mcp_1',
        redirectUri: 'https://agent.example/cb',
        codeVerifier: 'v',
      },
    })
  })

  it('Given a refresh, When the form is read, Then its parts are named', () => {
    expect(
      parseTokenRequest(
        { grant_type: 'refresh_token', refresh_token: 'r', client_id: 'mcp_1' },
        RESOURCE,
      ),
    ).toEqual({
      ok: true,
      request: { grant: 'refresh_token', refreshToken: 'r', clientId: 'mcp_1' },
    })
  })

  it.each(['code', 'client_id', 'redirect_uri', 'code_verifier'])(
    'Given a code exchange without %s, When the form is read, Then it is an invalid request',
    (name) => {
      expect(parseTokenRequest({ ...exchange, [name]: '' }, RESOURCE)).toEqual({
        ok: false,
        error: 'invalid_request',
      })
    },
  )

  it.each([
    [
      'a refresh without the token',
      { grant_type: 'refresh_token', client_id: 'mcp_1' },
      'invalid_request',
    ],
    [
      'a refresh without the client',
      { grant_type: 'refresh_token', refresh_token: 'r' },
      'invalid_request',
    ],
    ['no grant type', {}, 'invalid_request'],
    [
      'client credentials',
      { grant_type: 'client_credentials' },
      'unsupported_grant_type',
    ],
    ['a password', { grant_type: 'password' }, 'unsupported_grant_type'],
    [
      'another resource',
      { ...exchange, resource: 'https://other.example/mcp' },
      'invalid_target',
    ],
  ])(
    'Given %s, When the form is read, Then it is refused as %s',
    (_, form, error) => {
      expect(parseTokenRequest(form, RESOURCE)).toEqual({ ok: false, error })
    },
  )
})
