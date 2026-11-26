import { describe, expect, test } from 'vitest'
import { findArticle } from '../help/catalog'
import { HELP_CATALOG } from '../help/default-catalog'
import { helpUrlOf, withHelpUrl } from './refusal-help'
import { refusalResult, toolError, toolResult } from './tools'

const ORIGIN = 'https://slide.example'

describe('the address of the article that goes with a refusal', () => {
  test.each([
    ['reconnect_required', '/help/agent/reconnect'],
    ['not_allowed', '/help/safety/appeal'],
    ['stale_cursor', '/help/agent/export-with-agent'],
    ['file_too_large', '/help/slides/limits'],
    ['daily_starts_exceeded', '/help/slides/limits'],
    ['deck_limit', '/help/slides/limits'],
    ['new_author_limit', '/help/slides/daily-limit'],
  ])(
    'F36-AC47: Given the refusal %s, When it is answered, Then the answer holds the address of %s and the article exists',
    (code, path) => {
      expect(helpUrlOf(code, ORIGIN)).toBe(`${ORIGIN}${path}`)
      const [, , aim, slug] = path.split('/')
      expect(findArticle(HELP_CATALOG, aim!, slug!)).not.toBeNull()
      const answered = withHelpUrl(refusalResult(code, 'Words.'), ORIGIN)
      expect(answered.isError).toBe(true)
      expect(answered.structuredContent).toEqual({
        error: code,
        message: 'Words.',
        help: `${ORIGIN}${path}`,
      })
      expect(answered.content[0]!.text).toContain(`${ORIGIN}${path}`)
    },
  )

  test('F36-AC47: Given a refusal with no article, a success and a name of Object’s own, When they are answered, Then they are as they were', () => {
    const none = toolError('unknown_slide')
    expect(withHelpUrl(none, ORIGIN)).toBe(none)
    const ok = toolResult({ slides: [] })
    expect(withHelpUrl(ok, ORIGIN)).toBe(ok)
    expect(helpUrlOf('constructor', ORIGIN)).toBeNull()
    expect(helpUrlOf('toString', ORIGIN)).toBeNull()
    expect(helpUrlOf('', ORIGIN)).toBeNull()
  })

  test('F36-AC47: Given the words of a refusal, When the address is added, Then the words are not changed', () => {
    const before = toolError('reconnect_required')
    const after = withHelpUrl(before, ORIGIN)
    expect(after.structuredContent.message).toBe(
      before.structuredContent.message,
    )
    expect(after.structuredContent.error).toBe('reconnect_required')
  })
})
