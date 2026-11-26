import { expect, test } from 'vitest'
import { WatchState, type Verdict } from './watch-state'

function memory() {
  const data = new Map<string, unknown>()
  const ctx = {
    storage: {
      get: async (key: string) => data.get(key),
      put: async (key: string, value: unknown) => void data.set(key, value),
    },
  } as unknown as DurableObjectState
  return { data, object: new WatchState(ctx) }
}

const post = (path: string, body: unknown) =>
  new Request(`https://watch.invalid${path}`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
const rules = {
  failuresToTell: 2,
  throttleSeconds: 3600,
  maintenanceChecksToFail: 72,
}
const observe = (name: string, seen: string, now: number) =>
  post('/observe', { name, seen, now, rules })

test('F39-AC14: Given two failed checks sent to the state, When it answers, Then the second says "down" and the state is kept', async () => {
  const { object, data } = memory()
  const first = (await (
    await object.fetch(observe('top', 'failed', 1000))
  ).json()) as Verdict
  expect(first).toEqual({ action: null, failures: 1 })
  const second = (await (
    await object.fetch(observe('top', 'failed', 1300))
  ).json()) as Verdict
  expect(second).toEqual({ action: 'down', failures: 2 })
  expect(data.get('target:top')).toEqual({
    failures: 2,
    noticeSent: true,
    lastNoticeAt: 1300,
    maintenance: 0,
  })
})

test('F39-AC14: Given two addresses, When one fails, Then the other is not touched', async () => {
  const { object } = memory()
  await object.fetch(observe('top', 'failed', 1000))
  const other = (await (
    await object.fetch(observe('viewer', 'failed', 1000))
  ).json()) as Verdict
  expect(other.failures).toBe(1)
})

test('F39-AC15: Given a notice told, When the state is sent an open check, Then it says "recovered"', async () => {
  const { object } = memory()
  await object.fetch(observe('top', 'failed', 1000))
  await object.fetch(observe('top', 'failed', 1300))
  const back = (await (
    await object.fetch(observe('top', 'ok', 1600))
  ).json()) as Verdict
  expect(back).toEqual({ action: 'recovered', failures: 0 })
})

test('F39-AC14: Given a notice that did not get out, When /unsent is sent, Then the next failed check tells again', async () => {
  const { object } = memory()
  await object.fetch(observe('top', 'failed', 1000))
  await object.fetch(observe('top', 'failed', 1300))
  expect((await object.fetch(post('/unsent', { name: 'top' }))).status).toBe(
    204,
  )
  const again = (await (
    await object.fetch(observe('top', 'failed', 1600))
  ).json()) as Verdict
  expect(again.action).toBe('down')
})

test('Given damaged stored state, When a check is sent, Then it starts from a fresh state', async () => {
  const { object, data } = memory()
  data.set('target:top', { failures: 'many' })
  const verdict = (await (
    await object.fetch(observe('top', 'failed', 1000))
  ).json()) as Verdict
  expect(verdict).toEqual({ action: null, failures: 1 })
})

test.each([
  [
    'an unknown address name',
    '/observe',
    { name: 'admin', seen: 'ok', now: 1, rules },
  ],
  [
    'an unknown observation',
    '/observe',
    { name: 'top', seen: 'fine', now: 1, rules },
  ],
  [
    'rules under 1',
    '/observe',
    {
      name: 'top',
      seen: 'ok',
      now: 1,
      rules: {
        failuresToTell: 0,
        throttleSeconds: 1,
        maintenanceChecksToFail: 1,
      },
    },
  ],
  ['a body that is not JSON', '/observe', 'not json'],
  ['an unknown name for /unsent', '/unsent', { name: 'x' }],
])(
  'Given %s, When it is sent, Then it is refused with a 400',
  async (_, path, body) => {
    const { object, data } = memory()
    expect((await object.fetch(post(path, body))).status).toBe(400)
    expect(data.size).toBe(0)
  },
)

test('Given a path that is not known or a method that is not POST, When it is sent, Then it is answered 404 or 405', async () => {
  const { object } = memory()
  expect((await object.fetch(post('/other', {}))).status).toBe(404)
  expect(
    (await object.fetch(new Request('https://watch.invalid/observe'))).status,
  ).toBe(405)
})

test('Given state stored before maintenance was counted, When a check is sent, Then it is read with a maintenance count of 0', async () => {
  const { object, data } = memory()
  data.set('target:top', { failures: 1, noticeSent: false, lastNoticeAt: null })
  const verdict = (await (
    await object.fetch(observe('top', 'failed', 1000))
  ).json()) as Verdict
  expect(verdict).toEqual({ action: 'down', failures: 2 })
  expect(data.get('target:top')).toMatchObject({ maintenance: 0 })
})

test('D-120: Given maintenance for longer than the limit sent to the state, When it goes on, Then it is told as down', async () => {
  const { object } = memory()
  const short = {
    failuresToTell: 2,
    throttleSeconds: 3600,
    maintenanceChecksToFail: 2,
  }
  const send = async (now: number) =>
    (await (
      await object.fetch(
        post('/observe', {
          name: 'top',
          seen: 'maintenance',
          now,
          rules: short,
        }),
      )
    ).json()) as Verdict
  expect((await send(1000)).action).toBeNull()
  expect((await send(1300)).action).toBeNull()
  expect((await send(1600)).action).toBeNull()
  expect((await send(1900)).action).toBe('down')
})

const END = Date.UTC(2026, 11, 1, 3, 0, 0) / 1000
const sighted = (
  checks: { seen: string; until: number | null }[],
  now: number,
  overrunSeconds = 1800,
) => post('/maintenance', { checks, now, overrunSeconds })
const maintenance = [
  { seen: 'maintenance', until: END },
  { seen: 'maintenance', until: END },
  { seen: 'maintenance', until: END },
]
const openChecks = [
  { seen: 'ok', until: null },
  { seen: 'ok', until: null },
  { seen: 'ok', until: null },
]
const told = async (object: WatchState, request: Request) =>
  ((await (await object.fetch(request)).json()) as { action: string | null })
    .action

test('F38-AC25: Given three runs of maintenance and then an open one, When they are sent to the state, Then started and ended come once each', async () => {
  const { object, data } = memory()
  expect(await told(object, sighted(maintenance, 1000))).toBe('started')
  expect(await told(object, sighted(maintenance, 1300))).toBeNull()
  expect(data.get('maintenance')).toMatchObject({ active: true, until: END })
  expect(await told(object, sighted(openChecks, 1600))).toBe('ended')
  expect(await told(object, sighted(openChecks, 1900))).toBeNull()
})

test('F38-AC26: Given maintenance that goes on past its end by half an hour, When the run is made, Then overrun is told once, and the setting of the time is the one sent', async () => {
  const { object } = memory()
  await object.fetch(sighted(maintenance, END - 600))
  expect(await told(object, sighted(maintenance, END + 1799))).toBeNull()
  expect(await told(object, sighted(maintenance, END + 1800))).toBe('overrun')
  expect(await told(object, sighted(maintenance, END + 2100))).toBeNull()
})

test('F38-AC25: Given a notice that did not get out, When the state is told so, Then the next run tells it again', async () => {
  const { object } = memory()
  expect(await told(object, sighted(maintenance, 1000))).toBe('started')
  const back = await object.fetch(
    post('/maintenance-unsent', { phase: 'started' }),
  )
  expect(back.status).toBe(204)
  expect(await told(object, sighted(maintenance, 1300))).toBe('started')
})

test('F38-AC25: Given the maintenance state and the address states, When both are written, Then they do not touch each other', async () => {
  const { object, data } = memory()
  await object.fetch(observe('top', 'failed', 1000))
  await object.fetch(sighted(maintenance, 1000))
  expect(data.get('target:top')).toMatchObject({ failures: 1 })
  expect(data.get('maintenance')).toMatchObject({ active: true })
})

test('F38-AC25: Given a stored maintenance state that cannot be read, When a run is made, Then it starts afresh and nothing is thrown', async () => {
  const { object, data } = memory()
  data.set('maintenance', { active: 'yes' })
  expect(await told(object, sighted(maintenance, 1000))).toBe('started')
})

test.each([
  ['no checks', { checks: [], now: 1, overrunSeconds: 1800 }],
  [
    'too many checks',
    {
      checks: Array(21).fill({ seen: 'ok', until: null }),
      now: 1,
      overrunSeconds: 1800,
    },
  ],
  [
    'an unknown result',
    { checks: [{ seen: 'gone', until: null }], now: 1, overrunSeconds: 1800 },
  ],
  [
    'a fractional end',
    {
      checks: [{ seen: 'maintenance', until: 1.5 }],
      now: 1,
      overrunSeconds: 1800,
    },
  ],
  [
    'a short overrun',
    { checks: [{ seen: 'ok', until: null }], now: 1, overrunSeconds: 1 },
  ],
  ['not an object', 'nope'],
])(
  'F38-AC25: Given %s, When it is sent to /maintenance, Then it is refused as a bad request',
  async (_, body) => {
    const { object } = memory()
    expect((await object.fetch(post('/maintenance', body))).status).toBe(400)
  },
)

test('F38-AC25: Given an unknown phase, When it is sent to /maintenance-unsent, Then it is a bad request', async () => {
  const { object } = memory()
  expect(
    (await object.fetch(post('/maintenance-unsent', { phase: 'later' })))
      .status,
  ).toBe(400)
})
