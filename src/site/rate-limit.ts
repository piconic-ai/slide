import type { MiddlewareHandler } from 'hono'
import {
  clientKey,
  limitGroupOf,
  RETRY_AFTER_SECONDS,
  type LimitGroup,
} from './rate-limit-policy'

const limiterOf = (env: Env, group: LimitGroup): RateLimit => {
  switch (group) {
    case 'auth':
      return env.AUTH_RATE_LIMITER
    case 'uploads':
      return env.UPLOAD_RATE_LIMITER
    case 'management':
      return env.MANAGEMENT_RATE_LIMITER
    case 'viewer':
      return env.VIEWER_RATE_LIMITER
    case 'content':
      return env.CONTENT_RATE_LIMITER
  }
}

/**
 * Whether a request is within the per-IP budget of its group. Cloudflare
 * sets CF-Connecting-IP on every request from the internet and clients
 * cannot forge it, so a request without it comes from local tooling and is
 * not counted.
 */
export async function withinLimit(
  env: Env,
  group: LimitGroup,
  request: Request,
): Promise<boolean> {
  const ip = request.headers.get('CF-Connecting-IP')
  if (!ip) return true
  const { success } = await limiterOf(env, group).limit({ key: clientKey(ip) })
  return success
}

/**
 * Refuses requests over the per-IP budget of their group before any handler
 * touches D1 or R2.
 */
export const rateLimit: MiddlewareHandler<{ Bindings: Env }> = async (
  c,
  next,
) => {
  const group = limitGroupOf(c.req.path)
  if (!group || (await withinLimit(c.env, group, c.req.raw))) return next()
  const headers = {
    'Retry-After': String(RETRY_AFTER_SECONDS),
    'Cache-Control': 'no-store',
  }
  return c.req.path.startsWith('/api/')
    ? c.json(
        { error: 'Too many requests; retry later', code: 'rate_limited' },
        429,
        headers,
      )
    : c.text('Too many requests; retry later', 429, headers)
}
