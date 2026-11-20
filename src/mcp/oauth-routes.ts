import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { withinLimit } from '../site/rate-limit'
import { RETRY_AFTER_SECONDS } from '../site/rate-limit-policy'
import { readBounded } from '../uploads/api'
import {
  ACCESS_TOKEN_PREFIX,
  ACCESS_TOKEN_SECONDS,
  hashToken,
  parseTokenRequest,
  grantIdOf,
  refreshTokenOf,
  REFRESH_TOKEN_SECONDS,
  tokenOf,
  verifiesChallenge,
  type TokenError,
  type TokenRequest,
} from './authorization'
import {
  MAX_REGISTRATION_BYTES,
  parseClientRegistration,
} from './client-registration'
import {
  MCP_SCOPE,
  REGISTER_PATH,
  RESOURCE_METADATA_PATH,
  ROOT_RESOURCE_METADATA_PATH,
  SERVER_METADATA_PATH,
  TOKEN_PATH,
  mcpResource,
  resourceMetadata,
  serverMetadata,
} from './oauth-metadata'
import {
  insertClient,
  insertGrant,
  readClient,
  rotateGrant,
  takeCode,
  type TokenHashes,
} from './oauth-store'

const now = () => Math.floor(Date.now() / 1000)
const METADATA_CACHE = 'public, max-age=300'
const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * The parts of the OAuth authorization server that an MCP client calls
 * itself: discovery and registration. None of them reads a cookie; the
 * pages an author opens in a browser are in oauth-consent-routes.ts.
 */
export const oauthRoutes = new Hono<{ Bindings: Env }>()

for (const path of [RESOURCE_METADATA_PATH, ROOT_RESOURCE_METADATA_PATH])
  oauthRoutes.get(path, (c) =>
    c.json(resourceMetadata(c.env.PUBLIC_ORIGIN), 200, {
      'Cache-Control': METADATA_CACHE,
    }),
  )
oauthRoutes.get(SERVER_METADATA_PATH, (c) =>
  c.json(serverMetadata(c.env.PUBLIC_ORIGIN), 200, {
    'Cache-Control': METADATA_CACHE,
  }),
)

/** A JSON object from a request body of bounded size, or null. */
async function readJson(request: Request, maximum: number): Promise<unknown> {
  try {
    const bytes = await readBounded(request, maximum)
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    if (error instanceof HTTPException || error instanceof SyntaxError)
      return null
    throw error
  }
}

oauthRoutes.post(REGISTER_PATH, async (c) => {
  // Anyone may register, and each registration writes a row.
  if (!(await withinLimit(c.env, 'auth', c.req.raw)))
    return c.json({ error: 'rate_limited' }, 429, {
      ...NO_STORE,
      'Retry-After': String(RETRY_AFTER_SECONDS),
    })
  const parsed = parseClientRegistration(
    await readJson(c.req.raw, MAX_REGISTRATION_BYTES),
  )
  if (!parsed.ok)
    return c.json(
      { error: parsed.error, error_description: parsed.description },
      400,
      NO_STORE,
    )
  const id = `mcp_${crypto.randomUUID()}`
  const issuedAt = now()
  if (!(await insertClient(c.env.DB, { id, ...parsed.client }, issuedAt)))
    return c.json(
      {
        error: 'temporarily_unavailable',
        error_description:
          'Too many clients are waiting to connect; retry later',
      },
      503,
      { ...NO_STORE, 'Retry-After': String(RETRY_AFTER_SECONDS) },
    )
  return c.json(
    {
      client_id: id,
      client_id_issued_at: issuedAt,
      client_name: parsed.client.name,
      redirect_uris: parsed.client.redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    201,
    NO_STORE,
  )
})

const MAX_TOKEN_REQUEST_BYTES = 16 * 1024
const MAX_CLIENT_ID_LENGTH = 100
const FORM = /^application\/x-www-form-urlencoded[ \t]*(?:;|$)/i

const random = () => crypto.getRandomValues(new Uint8Array(32))

/**
 * A new pair of tokens for a grant, with what is stored of them: their
 * hashes.
 */
async function newTokens(grantId: string, at: number) {
  const access = `${ACCESS_TOKEN_PREFIX}${tokenOf(random())}`
  const refresh = refreshTokenOf(grantId, random())
  const hashes: TokenHashes = {
    accessTokenHash: await hashToken(access),
    accessExpiresAt: at + ACCESS_TOKEN_SECONDS,
    refreshTokenHash: await hashToken(refresh),
    refreshExpiresAt: at + REFRESH_TOKEN_SECONDS,
  }
  return { access, refresh, hashes }
}
type Tokens = Awaited<ReturnType<typeof newTokens>>

/** Replaces the tokens of the grant the refresh token names, or null. */
async function refreshed(
  database: D1Database,
  request: Extract<TokenRequest, { grant: 'refresh_token' }>,
  at: number,
): Promise<Tokens | null> {
  const id = grantIdOf(request.refreshToken)
  if (id === null) return null
  const tokens = await newTokens(id, at)
  const rotated = await rotateGrant(
    database,
    {
      id,
      clientId: request.clientId,
      refreshTokenHash: await hashToken(request.refreshToken),
    },
    tokens.hashes,
    at,
  )
  return rotated ? tokens : null
}

/**
 * The tokens of the grant the request asks for, saved as hashes, or null
 * when it is not given. A code is taken out before it is checked, so one
 * that fails any check cannot be tried again.
 */
async function grant(
  database: D1Database,
  request: TokenRequest,
  at: number,
): Promise<Tokens | null> {
  if (request.grant === 'refresh_token') return refreshed(database, request, at)
  const code = await takeCode(database, await hashToken(request.code), at)
  if (
    !code ||
    code.clientId !== request.clientId ||
    code.redirectUri !== request.redirectUri ||
    !(await verifiesChallenge(request.codeVerifier, code.codeChallenge))
  )
    return null
  const id = crypto.randomUUID()
  const tokens = await newTokens(id, at)
  await insertGrant(
    database,
    { id, clientId: code.clientId, ownerUserId: code.ownerUserId },
    tokens.hashes,
    at,
  )
  return tokens
}

/** The posted form's fields, or null when the body is not a small form. */
async function readForm(request: Request) {
  if (!FORM.test(request.headers.get('Content-Type') ?? '')) return null
  try {
    const bytes = await readBounded(request, MAX_TOKEN_REQUEST_BYTES)
    return Object.fromEntries(
      new URLSearchParams(new TextDecoder().decode(bytes)),
    )
  } catch (error) {
    if (error instanceof HTTPException) return null
    throw error
  }
}

oauthRoutes.post(TOKEN_PATH, async (c) => {
  const refuse = (error: TokenError) => c.json({ error }, 400, NO_STORE)
  if (!(await withinLimit(c.env, 'auth', c.req.raw)))
    return c.json({ error: 'rate_limited' }, 429, {
      ...NO_STORE,
      'Retry-After': String(RETRY_AFTER_SECONDS),
    })
  const form = await readForm(c.req.raw)
  if (!form) return refuse('invalid_request')
  const parsed = parseTokenRequest(form, mcpResource(c.env.PUBLIC_ORIGIN))
  if (!parsed.ok) return refuse(parsed.error)
  // A client that is gone is told so, as RFC 6749 5.2 says, so that an
  // agent holding its ID registers again instead of retrying for ever.
  const { clientId } = parsed.request
  if (
    clientId.length > MAX_CLIENT_ID_LENGTH ||
    !(await readClient(c.env.DB, clientId))
  )
    return c.json({ error: 'invalid_client' }, 401, NO_STORE)
  const tokens = await grant(c.env.DB, parsed.request, now())
  if (!tokens) return refuse('invalid_grant')
  return c.json(
    {
      access_token: tokens.access,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_SECONDS,
      refresh_token: tokens.refresh,
      scope: MCP_SCOPE,
    },
    200,
    NO_STORE,
  )
})
