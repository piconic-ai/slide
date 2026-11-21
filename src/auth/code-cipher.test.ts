import { expect, test } from 'vitest'
import { decryptCode, encryptCode } from './code-cipher'

const SECRET = 'test-only-better-auth-secret-32-bytes-long'

test('F28-AC9: Given a code sealed with the secret, When it is opened with it, Then the same code comes back', async () => {
  const sealed = await encryptCode(SECRET, '123456')
  expect(sealed).not.toContain('123456')
  expect(sealed).not.toContain(':')
  expect(await decryptCode(SECRET, sealed)).toBe('123456')
})

test('F28-AC9: Given a sealed code, When it is opened with another secret or tampered with, Then it fails', async () => {
  const sealed = await encryptCode(SECRET, '123456')
  await expect(decryptCode('x'.repeat(40), sealed)).rejects.toThrow()
  await expect(
    decryptCode(SECRET, `${sealed.slice(0, -2)}AA`),
  ).rejects.toThrow()
})
