import { describe, expect, test } from 'vitest'
import {
  admitsSignIn,
  OPEN_SIGNUP_INVITER,
  signupModeOf,
  type SignupMode,
} from './signup-mode'

describe('the setting OPEN_SIGNUP', () => {
  test('F42-AC1: Given no setting, When the mode is read, Then sign-up is invite-only', () => {
    expect(signupModeOf(undefined)).toBe('invitation')
  })

  test('F42-AC2: Given the value on, When the mode is read, Then sign-up is open', () => {
    expect(signupModeOf('on')).toBe('open')
  })

  test.each([
    '',
    ' ',
    'off',
    'ON',
    'On',
    'true',
    '1',
    'yes',
    ' on',
    'on ',
    'on\n',
    null,
    true,
    1,
    {},
    [],
  ])(
    'F42-AC1: Given the mistaken value %j, When the mode is read, Then sign-up stays invite-only',
    (value) => {
      expect(signupModeOf(value)).toBe('invitation')
    },
  )

  test('F42-AC4: Given the setting is taken away again, When the mode is read, Then sign-up is invite-only', () => {
    expect(signupModeOf('on')).toBe('open')
    expect(signupModeOf(undefined)).toBe('invitation')
  })
})

describe('who a login code is for', () => {
  const cases: [SignupMode, boolean, boolean][] = [
    ['invitation', true, true],
    ['invitation', false, false],
    ['open', true, true],
    ['open', false, true],
  ]
  test.each(cases)(
    'F42-AC1, F42-AC2: Given the mode %s and invited %s, When the address is checked, Then it is admitted: %s',
    (mode, invited, admitted) => {
      expect(admitsSignIn(mode, invited)).toBe(admitted)
    },
  )
})

test('F42-AC4: Given the word that marks an open sign-up, When it is compared with an operator address, Then it cannot be one', () => {
  // An operator is named by an email address, which always holds an @.
  expect(OPEN_SIGNUP_INVITER).not.toContain('@')
})
