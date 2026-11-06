import { describe, expect, test } from 'vitest'
import {
  authorizeUrl,
  codeChallenge,
  ownerDecision,
  parseOAuthStart,
  serializeOAuthStart,
} from './github-oauth'

const token = 'A'.repeat(43)

describe('oauth start cookie', () => {
  test('round-trips state and verifier', () => {
    const start = {
      state: token,
      verifier: 'b'.repeat(43),
      intent: { kind: 'login' } as const,
    }
    expect(parseOAuthStart(serializeOAuthStart(start))).toEqual(start)
    const bind = {
      ...start,
      intent: {
        kind: 'bind' as const,
        request: { deck: 'talk', repository: 'o/r', branches: ['main'] },
      },
    }
    expect(parseOAuthStart(serializeOAuthStart(bind))?.intent).toEqual({
      kind: 'bind',
      request: {
        deck: 'talk',
        repository: 'o/r',
        branches: ['refs/heads/main'],
      },
    })
  })

  test.each([
    undefined,
    '',
    token,
    `${token}.`,
    `${token}.${token}.${token}`,
    `${token}.${'+'.repeat(43)}`,
    `${token}.${token}`,
    `${token}.${token}.e30`,
    `${token}.${token}.bm90LWpzb24`,
  ])('rejects %j', (value) => {
    expect(parseOAuthStart(value)).toBeNull()
  })
})

describe('authorize url', () => {
  test('requests PKCE without OAuth scopes', async () => {
    // RFC 7636 appendix B test vector.
    const challenge = await codeChallenge(
      'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
    )
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
    const url = new URL(
      authorizeUrl({
        clientId: 'Iv1.client',
        redirectUri: 'https://slide.example/auth/github/callback',
        state: token,
        challenge,
      }),
    )
    expect(url.origin + url.pathname).toBe(
      'https://github.com/login/oauth/authorize',
    )
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'Iv1.client',
      redirect_uri: 'https://slide.example/auth/github/callback',
      state: token,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      allow_signup: 'false',
    })
  })
})

describe('owner decision', () => {
  test('accepts only the configured numeric user ID', () => {
    expect(ownerDecision({ id: 722500, login: 'owner' }, '722500')).toEqual({
      ok: true,
      userId: '722500',
      login: 'owner',
    })
    expect(ownerDecision({ id: 7225001, login: 'other' }, '722500')).toEqual({
      ok: false,
    })
  })
})
