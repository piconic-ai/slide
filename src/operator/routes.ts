import { Hono } from 'hono'
import type { JWTVerifyGetKey } from 'jose'
import { siteHeaders } from '../site/middleware'
import { ACCESS_TOKEN_HEADER, verifyAccessToken, type Operator } from './access'
import { accessKeys } from './access-client'
import { parseOperatorConfig, type OperatorConfig } from './config'
import { OPERATOR_PAGE_POLICY, operatorHome } from './pages'

/** The operator host's settings; null when none is configured. */
export function operatorConfigOf(env: Env): OperatorConfig | null {
  return parseOperatorConfig({
    origin: env.OPERATOR_ORIGIN,
    teamDomain: env.ACCESS_TEAM_DOMAIN,
    audience: env.ACCESS_AUD,
    publicOrigin: env.PUBLIC_ORIGIN,
    contentOrigin: env.CONTENT_ORIGIN,
  })
}

export const OPERATOR_ROBOTS_TXT = 'User-agent: *\nDisallow: /\n'

const now = () => Math.floor(Date.now() / 1000)

type OperatorEnv = { Bindings: Env; Variables: { operator: Operator } }

/**
 * The app that answers on the operator host and nowhere else. Cloudflare
 * Access stands in front of the host, and every request is verified again
 * here, so a request that reached the Worker by another path is answered
 * exactly like a missing page.
 */
export function operatorApp(
  config: OperatorConfig,
  keysOf: (issuer: string) => JWTVerifyGetKey = accessKeys,
) {
  const app = new Hono<OperatorEnv>()
  app.use(siteHeaders, async (c, next) => {
    await next()
    // Nothing here may be listed by a search engine or kept by a cache.
    c.res.headers.set('X-Robots-Tag', 'noindex, nofollow')
    c.res.headers.set('Cache-Control', 'no-store')
  })
  app.notFound((c) => c.text('Not found', 404))
  app.onError((error, c) => {
    console.error(JSON.stringify({ event: 'operator_error', name: error.name }))
    return c.text('Internal error', 500)
  })
  app.get('/robots.txt', (c) => c.text(OPERATOR_ROBOTS_TXT))
  app.use(async (c, next) => {
    if (!config.access) return c.notFound()
    const result = await verifyAccessToken(
      c.req.header(ACCESS_TOKEN_HEADER),
      config.access,
      keysOf(config.access.issuer),
      now(),
    )
    if (result.kind === 'denied') {
      console.warn(
        JSON.stringify({
          event: 'operator_access_denied',
          reason: result.reason,
        }),
      )
      return c.notFound()
    }
    c.set('operator', result.operator)
    await next()
  })
  app.get('/', (c) =>
    c.html(operatorHome(c.get('operator')), 200, {
      'Content-Security-Policy': OPERATOR_PAGE_POLICY,
    }),
  )
  return app
}
