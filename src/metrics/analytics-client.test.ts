import { expect, test, vi } from 'vitest'
import {
  AnalyticsApiError,
  isAccountId,
  queryAnalytics,
} from './analytics-client'

const ACCOUNT = '0123456789abcdef0123456789abcdef'
const request = {
  accountId: ACCOUNT,
  token: 'secret-token-123',
  sql: 'SELECT 1',
}

const answering = (status: number, body: unknown = { data: [] }) =>
  vi.fn(
    async (_url: unknown, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  )

test('F40-AC17: Given a request, When the API is asked, Then it is one POST of the SQL to the account’s SQL API with the token as a bearer', async () => {
  const send = answering(200, { data: [{ a: 1 }] })
  const body = await queryAnalytics(request, send as unknown as typeof fetch)
  expect(body).toEqual({ data: [{ a: 1 }] })
  expect(send).toHaveBeenCalledTimes(1)
  const [url, init] = send.mock.calls[0] ?? []
  expect(url).toBe(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/analytics_engine/sql`,
  )
  expect(init?.method).toBe('POST')
  expect(init?.body).toBe('SELECT 1')
  expect(init?.headers).toEqual({ Authorization: 'Bearer secret-token-123' })
  // A redirect would carry the token to another host. Workers accepts only
  // `follow` and `manual` (`error` throws a TypeError when the request is
  // made), so the redirect is received, not followed.
  expect(init?.redirect).toBe('manual')
})

test.each([301, 302, 307, 308])(
  'F40-AC17: Given the API answers a redirect (%i), When it is asked, Then it is a failure with that status, and the token is not sent on',
  async (status) => {
    const send = vi.fn(
      async () =>
        new Response(null, {
          status,
          headers: { Location: 'https://elsewhere.invalid/' },
        }),
    )
    const error = await queryAnalytics(
      request,
      send as unknown as typeof fetch,
    ).catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(AnalyticsApiError)
    expect((error as AnalyticsApiError).status).toBe(status)
    expect(send).toHaveBeenCalledTimes(1)
  },
)

test.each([400, 401, 403, 429, 500, 503])(
  'F40-AC17: Given the API answers %i, When it is asked, Then it fails with the status only, and neither the token nor the answer is in the error',
  async (status) => {
    const send = answering(status, { errors: ['secret-token-123 is bad'] })
    const error = await queryAnalytics(
      request,
      send as unknown as typeof fetch,
    ).catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(AnalyticsApiError)
    expect((error as AnalyticsApiError).status).toBe(status)
    expect(String((error as Error).message)).not.toContain('secret-token')
    expect(String((error as Error).message)).not.toContain('bad')
  },
)

test('F40-AC17: Given a 201 or another 2xx that is not 200, When it is asked, Then it is a failure, since only 200 is a success', async () => {
  await expect(
    queryAnalytics(request, answering(201) as unknown as typeof fetch),
  ).rejects.toBeInstanceOf(AnalyticsApiError)
})

test('F40-AC17: Given the network fails, When it is asked, Then the failure comes through', async () => {
  const send = vi.fn(async () => {
    throw new TypeError('offline')
  })
  await expect(
    queryAnalytics(request, send as unknown as typeof fetch),
  ).rejects.toThrow('offline')
})

test.each([
  '',
  'abc',
  ACCOUNT.toUpperCase(),
  `${ACCOUNT}0`,
  '../../x',
  `${ACCOUNT}/x`,
])(
  'F40-AC23: Given the account number %j that is no account number, When it is asked, Then nothing is sent, since the number is put into the address',
  async (accountId) => {
    const send = answering(200)
    await expect(
      queryAnalytics(
        { ...request, accountId },
        send as unknown as typeof fetch,
      ),
    ).rejects.toThrow(RangeError)
    expect(send).not.toHaveBeenCalled()
    expect(isAccountId(accountId)).toBe(false)
  },
)
