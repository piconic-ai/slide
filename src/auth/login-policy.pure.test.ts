import { expect, test } from 'vitest'
import {
  CODE_ATTEMPTS,
  CODE_LENGTH,
  CODE_SECONDS,
  decideSend,
  parseLoginCodeLimits,
} from './login-policy'

const limits = parseLoginCodeLimits({
  perAddress: 3,
  perSource: 5,
  windowSeconds: 100,
})

test('F28-AC10 F28-AC11: Given the policy, When its constants are read, Then a code is 6 digits, lasts 10 minutes and takes 5 tries', () => {
  expect([CODE_LENGTH, CODE_SECONDS, CODE_ATTEMPTS]).toEqual([6, 600, 5])
})

test('F28-AC15: Given no setting, When the limits are read, Then the defaults apply', () => {
  expect(parseLoginCodeLimits(undefined)).toEqual({
    perAddress: 5,
    perSource: 20,
    attemptsPerAddress: 10,
    windowSeconds: 3600,
  })
})

test.each([
  { perAddress: 0 },
  { perAddress: -1 },
  { perAddress: 1.5 },
  { perSource: 'many' },
  { unknown: 1 },
  'text',
  42,
])(
  'F28-AC15: Given the mistaken setting %j, When the limits are read, Then the defaults apply and nothing opens wider',
  (input) => {
    expect(parseLoginCodeLimits(input)).toEqual(parseLoginCodeLimits({}))
  },
)

test('F28-AC13: Given fewer requests than the limit, When a send is decided, Then it is allowed', () => {
  expect(decideSend(limits, 1000, { address: [990, 995], source: [] })).toEqual(
    {
      kind: 'allowed',
    },
  )
})

test('F28-AC13: Given the address is at its limit, When a send is decided, Then it is refused until the oldest of the newest requests leaves the window', () => {
  expect(
    decideSend(limits, 1000, { address: [920, 950, 990, 905], source: [] }),
  ).toEqual({ kind: 'limited', scope: 'address', retryAt: 1020 })
})

test('F28-AC14: Given the client is at its limit and the address is not, When a send is decided, Then the client scope refuses it', () => {
  expect(
    decideSend(limits, 1000, {
      address: [],
      source: [999, 998, 997, 996, 995],
    }),
  ).toEqual({ kind: 'limited', scope: 'source', retryAt: 1095 })
})

test('Given requests older than the window, When a send is decided, Then they no longer count', () => {
  expect(
    decideSend(limits, 1000, {
      address: [1, 2, 3, 4],
      source: [1, 2, 3, 4, 5],
    }),
  ).toEqual({ kind: 'allowed' })
})

test('Given the oldest of three requests is 100 seconds old, When a send is decided, Then it no longer counts and is allowed', () => {
  expect(
    decideSend(limits, 1000, { address: [900, 950, 960], source: [] }),
  ).toEqual({ kind: 'allowed' })
})
