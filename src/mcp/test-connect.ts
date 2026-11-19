import server from '../../server'
import { TEST_ORIGIN } from '../publication/test-support'
import { hashToken } from './authorization'

export const REDIRECT_URI = 'http://127.0.0.1:3334/callback'
export const VERIFIER = 'v'.repeat(43)

const post = (
  env: Env,
  path: string,
  body: BodyInit,
  headers: Record<string, string>,
) =>
  server.fetch(
    new Request(new URL(path, TEST_ORIGIN), { method: 'POST', headers, body }),
    env,
  )

/** Registers a client as an agent does, and returns its ID. */
export async function registerClient(
  env: Env,
  name = 'Test agent',
  redirectUris: readonly string[] = [REDIRECT_URI],
): Promise<string> {
  const response = await post(
    env,
    '/oauth/register',
    JSON.stringify({ client_name: name, redirect_uris: redirectUris }),
    { 'Content-Type': 'application/json' },
  )
  return ((await response.json()) as { client_id: string }).client_id
}

/** The fields of an authorization request for the client, with PKCE. */
export async function authorizationFields(
  clientId: string,
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  return {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: await hashToken(VERIFIER),
    code_challenge_method: 'S256',
    state: 'st4te',
    ...extra,
  }
}

/** Answers the consent form as the signed-in author; the raw response. */
export async function answerConsent(
  env: Env,
  cookie: string,
  fields: Record<string, string>,
  decision: 'allow' | 'deny' = 'allow',
  origin: string = TEST_ORIGIN,
) {
  return post(
    env,
    '/oauth/authorize',
    new URLSearchParams({ ...fields, decision }),
    { Cookie: cookie, Origin: origin },
  )
}

/** Posts a form to the token endpoint, with no cookie. */
export const requestToken = (env: Env, fields: Record<string, string>) =>
  post(env, '/oauth/token', new URLSearchParams(fields), {
    'Content-Type': 'application/x-www-form-urlencoded',
  })

export type Tokens = Readonly<{
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
  scope: string
}>

/**
 * Connects an agent the whole way: registers it, allows it as the signed-in
 * author, and exchanges the code. Returns the client and its tokens.
 */
export async function connectAgent(env: Env, cookie: string, name?: string) {
  const clientId = await registerClient(env, name)
  const allowed = await answerConsent(
    env,
    cookie,
    await authorizationFields(clientId),
  )
  const code =
    new URL(allowed.headers.get('location') ?? '').searchParams.get('code') ??
    ''
  const response = await requestToken(env, {
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_verifier: VERIFIER,
  })
  return { clientId, tokens: (await response.json()) as Tokens }
}
