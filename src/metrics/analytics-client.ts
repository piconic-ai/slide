/** What reading the SQL API needs: the account, the token and the SQL. */
export type AnalyticsRequest = Readonly<{
  accountId: string
  token: string
  sql: string
}>

/** The API did not answer 200. Only the status is kept: no body, no token. */
export class AnalyticsApiError extends Error {
  constructor(readonly status: number) {
    super(`The analytics API answered ${status}`)
    this.name = 'AnalyticsApiError'
  }
}

const ACCOUNT_ID = /^[0-9a-f]{32}$/u

/** Whether the text is an account's number as Cloudflare writes it. */
export const isAccountId = (text: string) => ACCOUNT_ID.test(text)

/**
 * Asks Workers Analytics Engine's SQL API: a POST of the SQL to the
 * account's `analytics_engine/sql` with the token as a bearer
 * (https://developers.cloudflare.com/analytics/analytics-engine/sql-api/).
 * Answers the JSON body. `send` is `fetch`; tests give their own, so no
 * request leaves the machine.
 */
export async function queryAnalytics(
  request: AnalyticsRequest,
  send: typeof fetch = fetch,
): Promise<unknown> {
  if (!isAccountId(request.accountId))
    throw new RangeError('Not an account number')
  const response = await send(
    `https://api.cloudflare.com/client/v4/accounts/${request.accountId}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${request.token}` },
      body: request.sql,
      // A redirect would carry the token somewhere else, so it is received and
      // not followed: its status is not 200, and the call fails below. Not
      // `error`: Workers does not implement that mode and throws a TypeError
      // when the request is made, which no stub of `fetch` shows.
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    },
  )
  if (response.status !== 200) throw new AnalyticsApiError(response.status)
  return response.json()
}
