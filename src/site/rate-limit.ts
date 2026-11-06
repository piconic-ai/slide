import type { MiddlewareHandler } from 'hono'
import {
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
  }
}

/**
 * Refuses requests over the per-IP budget of their group before any handler
 * touches D1 or R2. Cloudflare sets CF-Connecting-IP on every request from
 * the internet and clients cannot forge it, so a request without it comes
 * from local tooling and is not counted.
 */
export const rateLimit: MiddlewareHandler<{ Bindings: Env }> = async (
  c,
  next,
) => {
  const group = limitGroupOf(c.req.path)
  const key = c.req.header('CF-Connecting-IP')
  if (!group || !key) return next()
  const { success } = await limiterOf(c.env, group).limit({ key })
  if (success) return next()
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
