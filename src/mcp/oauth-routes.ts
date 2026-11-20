import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { withinLimit } from '../site/rate-limit'
import { RETRY_AFTER_SECONDS } from '../site/rate-limit-policy'
import { readBounded } from '../uploads/api'
import {
  MAX_REGISTRATION_BYTES,
  parseClientRegistration,
} from './client-registration'
import {
  REGISTER_PATH,
  RESOURCE_METADATA_PATH,
  ROOT_RESOURCE_METADATA_PATH,
  SERVER_METADATA_PATH,
  resourceMetadata,
  serverMetadata,
} from './oauth-metadata'
import { insertClient } from './oauth-store'

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
