import { expect, test } from 'vitest'
import { HANDLE_HOLD_SECONDS, isHeld } from './hold'

const released = 1_000_000

test.each([
  ['the moment it was let go of', 0, true],
  ['one second before 90 days', HANDLE_HOLD_SECONDS - 1, true],
  ['exactly 90 days', HANDLE_HOLD_SECONDS, false],
  ['a year', 365 * 24 * 60 * 60, false],
])(
  'F30-AC4: Given a handle let go of, When %s has passed, Then it is held: %s',
  (_, passed, held) => {
    expect(isHeld(released, released + passed)).toBe(held)
  },
)

test('F30-AC4: Given a release time after now (a clock that went back), When it is checked, Then the handle is still held', () => {
  expect(isHeld(released, released - 10)).toBe(true)
})

test('F30-AC4: Given the hold, When it is counted in days, Then it is 90', () => {
  expect(HANDLE_HOLD_SECONDS / (24 * 60 * 60)).toBe(90)
})
