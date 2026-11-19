import { describe, expect, it } from 'vitest'
import { startRejections } from '../uploads/rejections'
import { uploadRefusal } from './refusal'

describe('uploadRefusal', () => {
  it.each(startRejections)(
    'F23-AC10: Given a start refused for %s, When it is read, Then the limit is the code and the message says which limit',
    (reason) => {
      const refusal = uploadRefusal({
        status: 413,
        message: 'internal words',
        code: 'start_rejected',
        details: { reason, deploymentId: 'd' },
      })
      expect(refusal?.code).toBe(reason)
      expect(refusal?.message).not.toBe('internal words')
      expect(refusal?.message.length).toBeGreaterThan(10)
    },
  )

  it.each(['upload_busy', 'deck_limit', 'credential_expired'])(
    'Given a refusal coded %s, When it is read, Then the code and the message are passed on',
    (code) => {
      expect(
        uploadRefusal({ status: 429, message: 'Retry later', code }),
      ).toEqual({ code, message: 'Retry later' })
    },
  )

  it('F23-AC10: Given a 403 without a code, When it is read, Then the account or slide is not allowed', () => {
    expect(
      uploadRefusal({
        status: 403,
        message: 'Uploads to this slide are not accepted',
      }),
    ).toMatchObject({ code: 'not_allowed' })
  })

  it.each([
    ['an unknown code', { status: 409, message: 'x', code: 'session_failed' }],
    [
      'an unknown reason',
      { status: 413, message: 'x', details: { reason: 'made_up' } },
    ],
    ['a plain error', { status: 500, message: 'x' }],
  ])('Given %s, When it is read, Then it is a plain failure', (_, input) => {
    expect(uploadRefusal(input)).toEqual({
      code: 'upload_failed',
      message: 'x',
    })
  })

  it.each([
    ['null', null],
    ['a string', 'refused'],
    ['an object without a status', { message: 'x' }],
    ['a code that is no string', { status: 400, message: 'x', code: 7 }],
  ])('Given %s, When it is read, Then it is no refusal', (_, input) => {
    expect(uploadRefusal(input)).toBeNull()
  })
})
