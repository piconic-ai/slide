import type { Context } from 'hono'
import { langOf } from '../site/lang'
import { readReadyAt } from './ready-store'
import { afterResponse, record } from './record-routes'

type Published = Readonly<{
  deckId: string
  deploymentId: string
  /** When it was made public, in seconds. */
  at: number
}>

/**
 * Counts a version being made public, with how long it waited since it was
 * put (F40-AC2, F40-AC7). The wait is read after the response, and only
 * where the dataset is bound, so a service without it pays for no query and
 * a failed read is no fault of the author's request.
 */
export const recordPublished = (c: Context, published: Published) => {
  const env = c.env as Env
  const lang = langOf(c)
  if (!env.ANALYTICS) return Promise.resolve()
  return afterResponse(
    c,
    readReadyAt(env.DB, published.deploymentId).then((readyAt) =>
      record(
        env,
        {
          name: 'deck_published',
          deckId: published.deckId,
          // A version with no ready time has no wait to report.
          lagSeconds:
            readyAt === null ? 0 : Math.max(0, published.at - readyAt),
        },
        lang,
      ),
    ),
  )
}
