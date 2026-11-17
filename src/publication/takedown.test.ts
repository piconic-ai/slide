import { expect, test } from 'vitest'
import {
  blockedByTakedown,
  decideOperator,
  OPERATOR_MAX,
  parseTakedown,
  TAKEDOWN_REASON_MAX,
  takedownColumns,
  type Takedown,
} from './takedown'

const hidden: Takedown = { hiddenAt: 10, reason: 'phishing', operator: 'op' }
const hide = (reason: string) =>
  ({ kind: 'hide', reason, operator: 'op@example.com' }) as const

test('Given a visible deck, When an operator hides it with a reason, Then the takedown records the trimmed reason, the time, and the operator', () => {
  expect(decideOperator(null, hide('  fake sign-in page \n'), 42)).toEqual({
    kind: 'apply',
    next: {
      hiddenAt: 42,
      reason: 'fake sign-in page',
      operator: 'op@example.com',
    },
  })
})

test.each([
  ['an empty reason', ''],
  ['a reason of only spaces', ' \n\t '],
  ['a reason over the limit', 'x'.repeat(TAKEDOWN_REASON_MAX + 1)],
])(
  'Given %s, When an operator hides a deck, Then the command is refused',
  (_, reason) => {
    expect(decideOperator(null, hide(reason), 1)).toEqual({
      kind: 'invalid_reason',
    })
  },
)

test('Given a reason exactly at the limit, When an operator hides a deck, Then it applies', () => {
  const decision = decideOperator(
    null,
    hide('x'.repeat(TAKEDOWN_REASON_MAX)),
    1,
  )
  expect(decision.kind).toBe('apply')
})

test('Given a hidden deck, When it is hidden again, Then the first record is kept', () => {
  expect(decideOperator(hidden, hide('another reason'), 99)).toEqual({
    kind: 'unchanged',
  })
})

test('Given a hidden deck, When it is hidden again without a reason, Then the reason is still refused', () => {
  expect(decideOperator(hidden, hide(''), 99)).toEqual({
    kind: 'invalid_reason',
  })
})

test('Given a hidden deck, When an operator releases it, Then the takedown is cleared', () => {
  expect(decideOperator(hidden, { kind: 'release' }, 99)).toEqual({
    kind: 'apply',
    next: null,
  })
})

test('Given a visible deck, When an operator releases it, Then nothing changes', () => {
  expect(decideOperator(null, { kind: 'release' }, 99)).toEqual({
    kind: 'unchanged',
  })
})

test('Given stored takedown columns, When they are parsed, Then they round-trip through the column values', () => {
  expect(parseTakedown(takedownColumns(hidden))).toEqual(hidden)
  expect(parseTakedown(takedownColumns(null))).toBeNull()
})

test.each([
  { hidden_at: 1, hidden_reason: null, hidden_by: null },
  { hidden_at: null, hidden_reason: 'r', hidden_by: null },
  { hidden_at: null, hidden_reason: null, hidden_by: 'op' },
  { hidden_at: 1, hidden_reason: 'r', hidden_by: null },
])(
  'Given contradictory takedown columns %o, When they are parsed, Then they are rejected',
  (row) => {
    expect(() => parseTakedown(row)).toThrow()
  },
)

test('F17-AC10: Given a hidden deck, When its publication would change, Then the change is blocked, and a visible deck blocks nothing', () => {
  expect(blockedByTakedown(hidden)).toBe(true)
  expect(blockedByTakedown(null)).toBe(false)
})

test.each([
  ['an empty operator', ''],
  ['an operator over the limit', 'x'.repeat(OPERATOR_MAX + 1)],
])(
  'Given %s, When a deck is hidden, Then the command is refused',
  (_, operator) => {
    expect(
      decideOperator(null, { kind: 'hide', reason: 'r', operator }, 1),
    ).toEqual({ kind: 'invalid_operator' })
  },
)
