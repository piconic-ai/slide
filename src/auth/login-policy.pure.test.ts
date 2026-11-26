import { expect, test } from 'vitest'
import {
  CODE_ATTEMPTS,
  CODE_LENGTH,
  CODE_SECONDS,
  decideSend,
  mailFloodWarnAt,
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
    total: null,
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
  expect(
    decideSend(limits, 1000, { address: [990, 995], source: [], total: [] }),
  ).toEqual({
    kind: 'allowed',
  })
})

test('F28-AC13: Given the address is at its limit, When a send is decided, Then it is refused until the oldest of the newest requests leaves the window', () => {
  expect(
    decideSend(limits, 1000, {
      address: [920, 950, 990, 905],
      source: [],
      total: [],
    }),
  ).toEqual({ kind: 'limited', scope: 'address', retryAt: 1020 })
})

test('F28-AC14: Given the client is at its limit and the address is not, When a send is decided, Then the client scope refuses it', () => {
  expect(
    decideSend(limits, 1000, {
      address: [],
      source: [999, 998, 997, 996, 995],
      total: [],
    }),
  ).toEqual({ kind: 'limited', scope: 'source', retryAt: 1095 })
})

test('Given requests older than the window, When a send is decided, Then they no longer count', () => {
  expect(
    decideSend(limits, 1000, {
      address: [1, 2, 3, 4],
      source: [1, 2, 3, 4, 5],
      total: [],
    }),
  ).toEqual({ kind: 'allowed' })
})

test('Given the oldest of three requests is 100 seconds old, When a send is decided, Then it no longer counts and is allowed', () => {
  expect(
    decideSend(limits, 1000, {
      address: [900, 950, 960],
      source: [],
      total: [],
    }),
  ).toEqual({ kind: 'allowed' })
})

const capped = parseLoginCodeLimits({
  perAddress: 3,
  perSource: 5,
  total: 4,
  windowSeconds: 100,
})

test('F42-AC29: Given no setting, When the limits are read, Then there is no total cap', () => {
  expect(parseLoginCodeLimits(undefined).total).toBeNull()
  expect(parseLoginCodeLimits({ perAddress: 9 }).total).toBeNull()
  expect(parseLoginCodeLimits(undefined).windowSeconds).toBe(3600)
})

test('F42-AC29: Given a total of 0, When the limits are read, Then it is off, and the other values set are kept', () => {
  expect(parseLoginCodeLimits({ total: 0, perAddress: 9 })).toMatchObject({
    total: null,
    perAddress: 9,
  })
})

test('F42-AC25 F42-AC22: Given a total of 1 or more in the setting, When the limits are read, Then it is the one used', () => {
  expect(parseLoginCodeLimits({ total: 250 }).total).toBe(250)
  expect(parseLoginCodeLimits({ total: 1 }).total).toBe(1)
})

test.each([
  { total: -5 },
  { total: 2.5 },
  { total: '100' },
  { total: null },
  { total: 1_000_001 },
])(
  'F42-AC29: Given the mistaken total %j, When the limits are read, Then there is no total cap, and the rest of the setting is dropped to the defaults, so nothing opens wider',
  (input) => {
    const read = parseLoginCodeLimits({ ...input, perAddress: 9 })
    expect(read).toEqual(parseLoginCodeLimits({}))
    expect(read.total).toBeNull()
  },
)

test('F42-AC29: Given no total cap, When a send is decided with any number of requests from everyone, Then the total never refuses it', () => {
  const off = parseLoginCodeLimits({ perAddress: 3, perSource: 5 })
  expect(
    decideSend(off, 1000, {
      address: [],
      source: [],
      total: Array.from({ length: 10_000 }, () => 999),
    }),
  ).toEqual({ kind: 'allowed' })
})

test('F42-AC29: Given no total cap and an address at its own limit, When a send is decided, Then the address limit still refuses it', () => {
  const off = parseLoginCodeLimits({ perAddress: 3, perSource: 5 })
  expect(
    decideSend(off, 1000, {
      address: [990, 991, 992],
      source: [],
      total: [],
    }),
  ).toMatchObject({ kind: 'limited', scope: 'address' })
})

test('F42-AC25: Given fewer codes than the total from everyone, When a send is decided, Then it is allowed', () => {
  expect(
    decideSend(capped, 1000, {
      address: [],
      source: [],
      total: [999, 998, 997],
    }),
  ).toEqual({ kind: 'allowed' })
})

test('F42-AC25: Given the total is reached by many addresses and clients, When a send is decided for a new address and client, Then it is refused until the oldest of the newest codes leaves the window', () => {
  expect(
    decideSend(capped, 1000, {
      address: [],
      source: [],
      total: [999, 990, 960, 920, 905],
    }),
  ).toEqual({ kind: 'limited', scope: 'total', retryAt: 1020 })
})

test('F42-AC28: Given an address at its own limit and the total also reached, When a send is decided, Then the address scope still speaks first, since the total is added to the two limits, not instead of them', () => {
  expect(
    decideSend(capped, 1000, {
      address: [990, 991, 992],
      source: [],
      total: [999, 998, 997, 996],
    }),
  ).toMatchObject({ kind: 'limited', scope: 'address' })
})

test('F42-AC25: Given codes older than the window, When a send is decided, Then they do not count toward the total', () => {
  expect(
    decideSend(capped, 1000, {
      address: [],
      source: [],
      total: [1, 2, 3, 4, 5],
    }),
  ).toEqual({ kind: 'allowed' })
})

test.each([
  [100, 80],
  [10, 8],
  [7, 6],
  [1, 1],
  [3, 3],
])(
  'F42-AC27: Given a total of %i, When the point to tell the operator is worked out, Then it is %i, 80% rounded up',
  (total, at) => {
    expect(mailFloodWarnAt(parseLoginCodeLimits({ total }))).toBe(at)
  },
)

test('F42-AC29: Given no total cap, When the point to tell the operator is worked out, Then there is none', () => {
  expect(mailFloodWarnAt(parseLoginCodeLimits({}))).toBeNull()
  expect(mailFloodWarnAt(parseLoginCodeLimits({ total: 0 }))).toBeNull()
})
