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

  it('F42-AC20: Given a new author at the limit, When it is read, Then the code is passed on and the message says when a new slide can be started again', () => {
    expect(
      uploadRefusal({
        status: 429,
        message: 'A newly registered account may put up only a few',
        code: 'new_author_limit',
        details: { availableAt: String(Date.UTC(2026, 10, 27, 3, 4) / 1000) },
      }),
    ).toEqual({
      code: 'new_author_limit',
      message:
        'A newly registered account may put up only a few. A new slide can be started again from 2026-11-27T03:04:00Z (UTC).',
    })
  })

  it.each([undefined, 'soon', '', '1e400', '9'.repeat(20)])(
    'F42-AC20: Given a limit refusal whose time is %j, When it is read, Then the reason is still given without a made-up time',
    (availableAt) => {
      expect(
        uploadRefusal({
          status: 429,
          message: 'Reason',
          code: 'new_author_limit',
          details: availableAt === undefined ? {} : { availableAt },
        }),
      ).toEqual({ code: 'new_author_limit', message: 'Reason' })
    },
  )

  it('F42-AC20: Given an account that is not registered, When it is read, Then its reason is passed on and not folded into not_allowed', () => {
    expect(
      uploadRefusal({
        status: 403,
        message: 'This account may not put slides here',
        code: 'not_registered',
      }),
    ).toEqual({
      code: 'not_registered',
      message: 'This account may not put slides here',
    })
  })

  it('F23-AC10: Given a 403 without a code, When it is read, Then the account or slide is not allowed', () => {
    expect(
      uploadRefusal({
        status: 403,
        message: 'Uploads to this slide are not accepted',
      }),
    ).toMatchObject({ code: 'not_allowed' })
  })

  it('Given a finalize that lacks files, When it is read, Then the missing paths are named', () => {
    expect(
      uploadRefusal({
        status: 409,
        message: 'Files are missing',
        code: 'files_missing',
        details: { missing: ['a.css', 'b.png'] },
      }),
    ).toEqual({
      code: 'files_missing',
      message:
        'Not every file has arrived: a.css, b.png. Send the missing files to their URLs, then call finish_upload again.',
    })
    expect(
      uploadRefusal({ status: 409, message: 'x', code: 'files_missing' })
        ?.message,
    ).toContain('Not every file has arrived.')
  })

  it('F23-AC7: Given a 401 from the upload routes, When it is read, Then the credential is wrong or expired', () => {
    expect(
      uploadRefusal({
        status: 401,
        message: 'Invalid or expired upload credential',
      }),
    ).toMatchObject({ code: 'credential_expired' })
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
