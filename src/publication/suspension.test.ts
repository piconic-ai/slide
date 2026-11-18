import { expect, test } from 'vitest'
import {
  decideSuspension,
  type Suspension,
  type SuspensionCommand,
} from './suspension'
import { OPERATOR_MAX, TAKEDOWN_REASON_MAX } from './takedown'

const suspended: Suspension = {
  suspendedAt: 100,
  reason: 'first reason',
  operator: 'first@example.com',
}
const suspend = (
  reason: string,
  operator = 'op@example.com',
): SuspensionCommand => ({
  kind: 'suspend',
  reason,
  operator,
})

test.each([
  ['surrounding whitespace', ' \n reason \t', 'reason'],
  [
    'the maximum length',
    'r'.repeat(TAKEDOWN_REASON_MAX),
    'r'.repeat(TAKEDOWN_REASON_MAX),
  ],
  ['HTML', '<script>alert(1)</script>', '<script>alert(1)</script>'],
  ['emoji', '😀', '😀'],
  ['an unpaired surrogate', '\ud800', '\ud800'],
])(
  'F17-AC27: Given a reason with %s, When a normal account is suspended, Then the decision records the trimmed reason, time and operator',
  (_, reason, expected) => {
    expect(decideSuspension(null, suspend(reason), 200)).toEqual({
      kind: 'apply',
      next: { suspendedAt: 200, reason: expected, operator: 'op@example.com' },
    })
  },
)

test.each(['', ' \n\t ', 'r'.repeat(TAKEDOWN_REASON_MAX + 1)])(
  'F17-AC27: Given invalid reason %j, When either a normal or suspended account is suspended, Then the reason is refused',
  (reason) => {
    for (const current of [null, suspended])
      expect(decideSuspension(current, suspend(reason), 200)).toEqual({
        kind: 'invalid_reason',
      })
  },
)

test.each(['', 'x'.repeat(OPERATOR_MAX + 1)])(
  'F17-AC27: Given invalid operator %j, When either a normal or suspended account is suspended, Then the operator is refused',
  (operator) => {
    for (const current of [null, suspended])
      expect(
        decideSuspension(current, suspend('reason', operator), 200),
      ).toEqual({ kind: 'invalid_operator' })
  },
)

test('F17-AC27: Given an operator at the length limit, When an account is suspended, Then the operator is accepted', () => {
  expect(
    decideSuspension(null, suspend('reason', 'x'.repeat(OPERATOR_MAX)), 200)
      .kind,
  ).toBe('apply')
})

test('F17-AC27: Given a suspended account, When another operator suspends it again, Then the first reason, time and operator stay unchanged', () => {
  const current = { ...suspended }
  expect(
    decideSuspension(current, suspend('second', 'second@example.com'), 200),
  ).toEqual({ kind: 'unchanged' })
  expect(current).toEqual(suspended)
})

test('F17-AC28: Given a suspended account, When it is released, Then the decision clears the suspension', () => {
  expect(decideSuspension(suspended, { kind: 'release' }, 200)).toEqual({
    kind: 'apply',
    next: null,
  })
})

test('F17-AC28: Given an account without a suspension, When it is released, Then nothing changes', () => {
  expect(decideSuspension(null, { kind: 'release' }, 200)).toEqual({
    kind: 'unchanged',
  })
})
