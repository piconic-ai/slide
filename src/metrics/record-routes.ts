import type { Context } from 'hono'
import { langOf } from '../site/lang'
import type { Lang } from '../site/i18n'
import { writeDataPoint } from './event-store'
import { dataPointOf, type MetricEvent } from './events'
import { ownHostsOf } from './referrer'

/**
 * Counts one event (D-71, D-72). This is the one door to the records: it takes
 * only a `MetricEvent`, which has no place for anything that identifies a
 * person. It does nothing where the dataset is not bound (D-08), never waits
 * for the write, and never throws: whatever goes wrong in counting is not the
 * reader's concern (F40-AC24).
 *
 * `lang` is the language of the screen, when the caller knows it.
 */
export function record(env: Env, event: MetricEvent, lang?: Lang): void {
  try {
    // The binding may be missing, though the generated type says it is not.
    const dataset: AnalyticsEngineDataset | undefined = env.ANALYTICS
    if (!dataset) return
    const point = dataPointOf(event, {
      lang: lang ?? null,
      own: ownHostsOf({
        publicOrigin: env.PUBLIC_ORIGIN,
        operatorOrigin: env.OPERATOR_ORIGIN,
        contentOrigin: env.CONTENT_ORIGIN,
      }),
    })
    if (point) writeDataPoint(dataset, point)
  } catch {
    console.error(JSON.stringify({ event: 'metric_failed', name: event.name }))
  }
}

/** `record`, with the language of the request. */
export const recordFrom = (c: Context, event: MetricEvent): void =>
  record(c.env as Env, event, langOf(c))

/**
 * Lets counting that needs a read finish after the response is sent, where
 * the platform allows it (F40-AC24); where there is no execution context
 * (tests, local tools) it is awaited. A failure is never the reader's.
 */
export async function afterResponse(
  c: Context,
  work: Promise<unknown>,
): Promise<void> {
  const settled = work.catch(() => {})
  try {
    c.executionCtx.waitUntil(settled)
  } catch {
    await settled
  }
}
