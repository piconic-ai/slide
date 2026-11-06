import { describe, expect, test } from 'vitest'
import {
  checkCredential,
  credentialExpiry,
  resumeSession,
  writeDecision,
} from './session'

const limits = { credentialSeconds: 60 }
const row = (
  state: 'uploading' | 'ready' | 'failed' | 'expired',
  expires_at = 1000,
  credential_expires_at = 500,
) => ({ state, expires_at, credential_expires_at })

describe('credential expiry', () => {
  test('never outlives the session', () => {
    expect(credentialExpiry(1000, 100, limits)).toBe(160)
    expect(credentialExpiry(1000, 980, limits)).toBe(1000)
  })
})

describe('credential check', () => {
  test.each([
    ['an open session before credential expiry', row('uploading'), 499, true],
    [
      'a ready deployment after session expiry',
      row('ready', 1000, 2000),
      1500,
      true,
    ],
    ['a failed deployment for reading its reason', row('failed'), 1, true],
  ])('accepts %s', (_name, input, now, ok) => {
    expect(checkCredential(input, now).ok).toBe(ok)
  })

  test.each([
    ['credential_expired', row('uploading'), 500],
    ['credential_expired', row('ready'), 500],
    ['session_expired', row('uploading'), 1000],
    ['session_expired', row('expired', 2000, 2000), 1],
    ['session_failed', row('failed'), 500],
  ])('rejects with %s', (code, input, now) => {
    expect(checkCredential(input, now)).toEqual({ ok: false, code })
  })
})

describe('session resume', () => {
  test('rotates an open session within its expiry', () => {
    expect(resumeSession(row('uploading'), 990, limits)).toEqual({
      ok: true,
      credentialExpiresAt: 1000,
    })
  })

  test('rotates a ready deployment for reading', () => {
    expect(resumeSession(row('ready'), 2000, limits)).toEqual({
      ok: true,
      credentialExpiresAt: 2060,
    })
  })

  test.each([
    ['session_expired', row('uploading'), 1000],
    ['session_expired', row('expired'), 1],
    ['session_failed', row('failed'), 1],
  ])('does not resume with %s', (code, input, now) => {
    expect(resumeSession(input, now, limits)).toEqual({ ok: false, code })
  })
})

describe('write decision', () => {
  test.each([
    ['uploading', { ok: true }],
    ['ready', { ok: false, code: 'immutable' }],
    ['failed', { ok: false, code: 'session_failed' }],
    ['expired', { ok: false, code: 'session_expired' }],
  ] as const)('maps %s', (state, expected) => {
    expect(writeDecision({ state })).toEqual(expected)
  })
})
