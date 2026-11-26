import { COPY_LOOKBACK_DAYS, addDays, dayOf, daysToCopy } from './day'
import { DATASET, dayQuery } from './day-query'
import { parseDayResponse } from './day-rows'
import {
  AnalyticsApiError,
  isAccountId,
  queryAnalytics,
} from './analytics-client'
import { readCopiedDays, replaceDay } from './daily-store'

/** One or more days could not be copied; the days that could were. */
export class CopyFailedError extends Error {
  constructor(readonly failed: number) {
    super(`${failed} of the days could not be copied`)
    this.name = 'CopyFailedError'
  }
}

/**
 * What the copy of the metrics needs, if all of it is set: the dataset's
 * binding, the token that reads it and the account's number (D-08, F40-AC23).
 * `missing` names what is not, for the operator's page.
 */
export function copySettingsOf(
  env: Env,
):
  | Readonly<{ kind: 'ready'; accountId: string; token: string }>
  | Readonly<{ kind: 'not_configured'; missing: readonly string[] }> {
  // The binding may be missing, though the generated type says it is not.
  const dataset: AnalyticsEngineDataset | undefined = env.ANALYTICS
  const token = env.ANALYTICS_READ_TOKEN?.trim()
  const accountId = env.ANALYTICS_ACCOUNT_ID?.trim()
  const missing = [
    ...(dataset ? [] : ['ANALYTICS']),
    ...(token ? [] : ['ANALYTICS_READ_TOKEN']),
    ...(accountId && isAccountId(accountId) ? [] : ['ANALYTICS_ACCOUNT_ID']),
  ]
  return missing.length > 0 || !token || !accountId
    ? { kind: 'not_configured', missing }
    : { kind: 'ready', accountId, token }
}

/**
 * The daily task (D-75, F40-AC17, F40-AC23): copies the days of the last
 * week that are not copied yet, oldest first, from Analytics Engine into D1.
 * It does nothing, and asks no one, where something it needs is not set. One
 * day failing does not stop the others; the task fails after them, so that it
 * is told (F39-AC3) and the next firing tries the days again. `send` is
 * `fetch`: tests give their own, so nothing leaves the machine.
 */
export async function copyMetrics(env: Env, at: number, send?: typeof fetch) {
  const settings = copySettingsOf(env)
  if (settings.kind === 'not_configured') return { days: 0, rows: 0 }
  const yesterday = addDays(dayOf(at), -1)
  const copied = await readCopiedDays(
    env.DB,
    addDays(yesterday, 1 - COPY_LOOKBACK_DAYS),
    yesterday,
  )
  let days = 0
  let rows = 0
  let failed = 0
  for (const day of daysToCopy(at, copied)) {
    try {
      const body = await queryAnalytics(
        {
          accountId: settings.accountId,
          token: settings.token,
          sql: dayQuery(DATASET, day),
        },
        send,
      )
      const copy = parseDayResponse(body)
      await replaceDay(env.DB, day, copy, at)
      days += 1
      rows += copy.rows.length
    } catch (error) {
      failed += 1
      // The name and, for the API, the status only: never the message,
      // which could carry what was sent.
      console.error(
        JSON.stringify({
          event: 'metrics_day_failed',
          day,
          name: error instanceof Error ? error.name : 'unknown',
          ...(error instanceof AnalyticsApiError
            ? { status: error.status }
            : {}),
        }),
      )
    }
  }
  if (failed > 0) throw new CopyFailedError(failed)
  return { days, rows }
}
