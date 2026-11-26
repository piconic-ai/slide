import { expect, test, vi } from 'vitest'
import {
  isMaintenanceAnswer,
  untilOf,
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
      (await observeAddress('https://x.example/', answering(status), 1000))
        .seen,
    ).toBe(seen)
  },
)

test('D-120: Given a 503 with the maintenance header, When the address is checked, Then it is maintenance, not a failure', async () => {
  const send = answering(503, { [MAINTENANCE_HEADER]: 'on' })
  expect(await observeAddress('https://x.example/', send, 1000)).toEqual({
    seen: 'maintenance',
    until: null,
  })
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
  expect(await observeAddress('https://x.example/', broken, 1000)).toEqual({
    seen: 'failed',
    until: null,
  })
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

const END = Date.UTC(2026, 11, 1, 3, 0, 0) / 1000

test.each([
  ['on;until=2026-12-01T03:00:00Z', END],
  ['on;until=2026-12-01t03:00:00z', END],
  [' on ; until=2026-12-01T03:00:00Z ', END],
  ['until=2026-12-01T03:00:00Z;on', END],
  ['on', null],
  ['', null],
  ['on;until=', null],
  ['on;until=soon', null],
  ['on;until=2026-02-30T03:00:00Z', null],
  ['on;until=2026-12-01T25:00:00Z', null],
  ['on;until=2026-12-01T03:00:00', null],
  ['on;until=2026-12-01T03:00:00+09:00', null],
  ['on;notuntil=2026-12-01T03:00:00Z', null],
])(
  'F38-AC26: Given the maintenance header %j, When its end is read, Then it is %j',
  (value, until) => {
    expect(untilOf(new Headers({ [MAINTENANCE_HEADER]: value }))).toBe(until)
  },
)

test('F38-AC26: Given no maintenance header, When its end is read, Then there is none', () => {
  expect(untilOf(new Headers())).toBeNull()
})

test('F38-AC26: Given a maintenance 503 that names its end, When the address is checked, Then the end comes with it', async () => {
  const send = answering(503, {
    [MAINTENANCE_HEADER]: 'on;until=2026-12-01T03:00:00Z',
  })
  expect(await observeAddress('https://x.example/', send, 1000)).toEqual({
    seen: 'maintenance',
    until: END,
  })
})

test('F38-AC26: Given an end named by an answer that is not maintenance, When it is checked, Then no end is taken from it', async () => {
  const send = answering(200, {
    [MAINTENANCE_HEADER]: 'on;until=2026-12-01T03:00:00Z',
  })
  expect(await observeAddress('https://x.example/', send, 1000)).toEqual({
    seen: 'ok',
    until: null,
  })
})
