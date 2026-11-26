import { expect, test, vi } from 'vitest'
import {
  isMaintenanceAnswer,
  MAINTENANCE_HEADER,
  observeAddress,
} from './observe'

const answering = (status: number, headers: HeadersInit = {}) =>
  vi.fn(
    async () =>
      new Response(status === 204 ? null : 'body', { status, headers }),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>

test.each([
  [200, 'ok'],
  [204, 'ok'],
  [301, 'ok'],
  [404, 'ok'],
  [429, 'ok'],
  [500, 'failed'],
  [502, 'failed'],
  [503, 'failed'],
  [522, 'failed'],
] as const)(
  'F39-AC12: Given an answer of %s, When the address is checked, Then it is %s',
  async (status, seen) => {
    expect(
      await observeAddress('https://x.example/', answering(status), 1000),
    ).toBe(seen)
  },
)

test('D-120: Given a 503 with the maintenance header, When the address is checked, Then it is maintenance, not a failure', async () => {
  const send = answering(503, { [MAINTENANCE_HEADER]: 'on' })
  expect(await observeAddress('https://x.example/', send, 1000)).toBe(
    'maintenance',
  )
})

test('D-120: Given the maintenance header on an answer that is not a 503, When it is judged, Then it is not maintenance', () => {
  const headers = new Headers({ [MAINTENANCE_HEADER]: 'on' })
  expect(isMaintenanceAnswer(200, headers)).toBe(false)
  expect(isMaintenanceAnswer(500, headers)).toBe(false)
  expect(isMaintenanceAnswer(503, new Headers())).toBe(false)
})

test('F39-AC12: Given a network error or a time out, When the address is checked, Then it is a failure', async () => {
  const broken = vi.fn(async () => {
    throw new TypeError('network')
  }) as unknown as typeof fetch
  expect(await observeAddress('https://x.example/', broken, 1000)).toBe(
    'failed',
  )
})

test('F39-AC12: Given any check, When the request is made, Then it is a GET that follows no redirect and carries no credential', async () => {
  const send = answering(200)
  await observeAddress('https://x.example/', send, 1000)
  const [url, init] = send.mock.calls[0] as [string, RequestInit]
  expect(url).toBe('https://x.example/')
  expect(init.method).toBe('GET')
  expect(init.redirect).toBe('manual')
  expect(Object.keys(init.headers as object)).toEqual(['User-Agent'])
})
