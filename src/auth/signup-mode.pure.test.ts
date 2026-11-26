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
  const modes: SignupMode[] = ['invitation', 'open']
  const flags = [true, false]
  const table = modes.flatMap((mode) =>
    flags.flatMap((paused) =>
      flags.flatMap((invited) =>
        flags.map((registered) => [mode, paused, invited, registered] as const),
      ),
    ),
  )
  test.each(table)(
    'F42-AC1, F42-AC2, F42-AC12, F42-AC13: Given the mode %s, paused %s, invited %s and registered %s, When the address is checked, Then it is admitted only as the rules say',
    (mode, paused, invited, registered) => {
      const expected = paused
        ? registered && (mode === 'open' || invited)
        : mode === 'open' || invited
      expect(admitsSignIn({ mode, paused }, { invited, registered })).toBe(
        expected,
      )
    },
  )

  test('F42-AC12: Given new sign-ups are stopped, When an address that is not registered is checked, Then no mode admits it, invited or not', () => {
    for (const mode of modes)
      for (const invited of flags)
        expect(
          admitsSignIn({ mode, paused: true }, { invited, registered: false }),
        ).toBe(false)
  })

  test('F42-AC13: Given new sign-ups are stopped, When a registered person who is invited is checked, Then they are admitted', () => {
    expect(
      admitsSignIn(
        { mode: 'invitation', paused: true },
        { invited: true, registered: true },
      ),
    ).toBe(true)
  })

  test('F42-AC1: Given invite-only and a registered person taken off the invitations, When they are checked, Then they are not admitted, paused or not', () => {
    for (const paused of flags)
      expect(
        admitsSignIn(
          { mode: 'invitation', paused },
          { invited: false, registered: true },
        ),
      ).toBe(false)
  })
})

test('F42-AC4: Given the word that marks an open sign-up, When it is compared with an operator address, Then it cannot be one', () => {
  // An operator is named by an email address, which always holds an @.
  expect(OPEN_SIGNUP_INVITER).not.toContain('@')
})
