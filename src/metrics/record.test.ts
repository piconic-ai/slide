import { afterEach, expect, test, vi } from 'vitest'
import { record } from './record-routes'

afterEach(() => vi.restoreAllMocks())

const written: unknown[] = []
const dataset = {
  writeDataPoint: (point: unknown) => {
    written.push(point)
  },
}
const base = {
  PUBLIC_ORIGIN: 'https://slide.example',
  OPERATOR_ORIGIN: 'https://admin.slide.example',
  CONTENT_ORIGIN: 'https://content.example',
}
const envOf = (extra: object = {}) => ({ ...base, ...extra }) as unknown as Env

test('F40-AC22: Given no dataset bound, When an event is recorded, Then nothing happens and nothing throws', () => {
  const error = vi.spyOn(console, 'error')
  expect(() => record(envOf(), { name: 'login_code_sent' })).not.toThrow()
  expect(error).not.toHaveBeenCalled()
})

test('F40-AC22: Given a dataset that is undefined or null, When an event is recorded, Then it is the same as having none', () => {
  for (const ANALYTICS of [undefined, null])
    expect(() =>
      record(envOf({ ANALYTICS }), { name: 'login_code_sent' }),
    ).not.toThrow()
})

test('F40-AC1: Given a dataset, When an event is recorded, Then one row is written with the event name as its index and the language', () => {
  written.length = 0
  record(envOf({ ANALYTICS: dataset }), { name: 'login_code_sent' }, 'en')
  expect(written).toEqual([
    {
      indexes: ['login_code_sent'],
      blobs: ['', '', 'en', '', ''],
      doubles: [],
    },
  ])
})

test('F40-AC15: Given an event that is not allowed to be written, When it is recorded, Then no row is written', () => {
  written.length = 0
  record(envOf({ ANALYTICS: dataset }), {
    name: 'help_search_empty',
    term: 'me@example.com',
  })
  expect(written).toEqual([])
})

test('F40-AC24: Given a dataset whose write throws, When an event is recorded, Then nothing is thrown and only the event name is logged', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const broken = {
    writeDataPoint: () => {
      throw new Error('secret detail me@example.com')
    },
  }
  expect(() =>
    record(envOf({ ANALYTICS: broken }), { name: 'login_code_sent' }),
  ).not.toThrow()
  expect(error).toHaveBeenCalledTimes(1)
  expect(String(error.mock.calls[0]?.[0])).toBe(
    JSON.stringify({ event: 'metric_write_failed', name: 'login_code_sent' }),
  )
})

test('F40-AC24: Given settings that cannot be read, When an event is recorded, Then nothing is thrown', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const hostile = new Proxy(
    {},
    {
      get() {
        throw new Error('boom')
      },
    },
  ) as Env
  expect(() => record(hostile, { name: 'login_code_sent' })).not.toThrow()
})
