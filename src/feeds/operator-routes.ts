import type { Hono, MiddlewareHandler } from 'hono'
import type { Operator } from '../operator/access'
import { lumaFeedTarget } from './luma-url'
import { resumedRecord } from './schedule'
import { readFeedRecord, writeFeedRecord } from './store'

/** What resuming a feed left to say, as `?result=`. */
export const FEED_RESULTS = ['feed_resumed', 'feed_not_stopped'] as const
export type FeedResult = (typeof FEED_RESULTS)[number]

type OperatorEnv = { Bindings: Env; Variables: { operator: Operator } }

/**
 * The operator's "resume" of a stopped feed (F33-AC9). Only the operator
 * host reaches it; `guard` is its check that a change comes from that
 * origin.
 */
export function mountFeedOperator(
  app: Hono<OperatorEnv>,
  guard: MiddlewareHandler<OperatorEnv>,
) {
  const done = (result: FeedResult) => `/?result=${result}`
  app.post('/feeds/resume', guard, async (c) => {
    const form = await c.req.parseBody()
    const url = typeof form.url === 'string' ? lumaFeedTarget(form.url) : null
    if (url === null) return c.redirect(done('feed_not_stopped'), 303)
    const record = await readFeedRecord(c.env.DB, url)
    if (record.state.kind !== 'stopped')
      return c.redirect(done('feed_not_stopped'), 303)
    await writeFeedRecord(
      c.env.DB,
      resumedRecord(record, Math.floor(Date.now() / 1000)),
    )
    return c.redirect(done('feed_resumed'), 303)
  })
}
