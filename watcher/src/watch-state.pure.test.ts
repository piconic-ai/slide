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
const rules = { failuresToTell: 2, throttleSeconds: 3600 }
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
      rules: { failuresToTell: 0, throttleSeconds: 1 },
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
