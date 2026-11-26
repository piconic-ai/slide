import { expect, test } from 'vitest'
import { parseAlertThresholds, SIGNAL_KEEP_SECONDS } from './thresholds'

const defaults = {
  loginMailFailures: 3,
  loginMailWindowSeconds: 3600,
  d1SizeBytes: 5_000_000_000,
  throttleSeconds: 3600,
}

test.each([
  ['undefined', undefined],
  ['null', null],
  ['an empty object', {}],
])(
  'F39-AC16: Given %s, When the thresholds are read, Then they are D-56 numbers',
  (_, input) => {
    expect(parseAlertThresholds(input)).toEqual(defaults)
  },
)

test('F39-AC16: Given some names set, When the thresholds are read, Then those change and the rest stay', () => {
  expect(
    parseAlertThresholds({ loginMailFailures: 10, d1SizeBytes: 1_000_000 }),
  ).toEqual({ ...defaults, loginMailFailures: 10, d1SizeBytes: 1_000_000 })
})

test.each([
  ['zero', { loginMailFailures: 0 }],
  ['negative', { loginMailFailures: 10, d1SizeBytes: -1 }],
  ['fractional', { loginMailFailures: 2.5 }],
  ['a string', { loginMailFailures: 10, throttleSeconds: '3600' }],
  ['NaN', { loginMailWindowSeconds: Number.NaN }],
  ['too large', { loginMailFailures: 10_000_000 }],
  ['an unknown name', { loginMailFailures: 10, loginMailFailure: 5 }],
  ['a string instead of an object', 'loginMailFailures=5'],
  ['an array', [3]],
])(
  'F39-AC16: Given a setting with %s, When the thresholds are read, Then every default is used, not half the setting',
  (_, input) => {
    expect(parseAlertThresholds(input)).toEqual(defaults)
  },
)

test('F39-AC16: Given a window as long as the failures are kept, When it is read, Then it is allowed, and one second longer gives the defaults', () => {
  expect(
    parseAlertThresholds({ loginMailWindowSeconds: SIGNAL_KEEP_SECONDS })
      .loginMailWindowSeconds,
  ).toBe(SIGNAL_KEEP_SECONDS)
  expect(
    parseAlertThresholds({ loginMailWindowSeconds: SIGNAL_KEEP_SECONDS + 1 })
      .loginMailWindowSeconds,
  ).toBe(3600)
})
