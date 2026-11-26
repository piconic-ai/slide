import { describe, expect, test } from 'vitest'
import { outcomeOf, recordToolUse } from './tool-use'

describe('the outcome of an answer', () => {
  test('Given an answer that is not a refusal, When its outcome is read, Then it is ok', () => {
    expect(outcomeOf({ structuredContent: { slides: [] } })).toBe('ok')
  })

  test('Given a refusal with a code, When its outcome is read, Then only the code is kept, not the message', () => {
    expect(
      outcomeOf({
        isError: true,
        structuredContent: { error: 'unknown_slide', message: 'Alice’s talk' },
      }),
    ).toEqual({ refusedAs: 'unknown_slide' })
  })

  test('Given a refusal whose code is not text, When its outcome is read, Then it is counted as unknown', () => {
    expect(
      outcomeOf({ isError: true, structuredContent: { error: 7 } }),
    ).toEqual({ refusedAs: 'unknown' })
    expect(outcomeOf({ isError: true, structuredContent: {} })).toEqual({
      refusedAs: 'unknown',
    })
  })

  test('Given the counting seam before the usage counts exist, When a call is told to it, Then it does nothing and does not throw', () => {
    expect(
      recordToolUse({} as Env, { tool: 'export_account', outcome: 'ok' }),
    ).toBeUndefined()
  })
})
