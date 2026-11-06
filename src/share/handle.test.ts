import { expect, test } from 'vitest'
import { handleOfLogin } from './handle'

test('Given GitHub logins, When turned into handles, Then they are lowercased or refused', () => {
  expect(handleOfLogin('KFly8')).toBe('kfly8')
  expect(handleOfLogin('a-b')).toBe('a-b')
  expect(handleOfLogin('')).toBeNull()
  expect(handleOfLogin('a b')).toBeNull()
  expect(handleOfLogin('a'.repeat(40))).toBeNull()
})
