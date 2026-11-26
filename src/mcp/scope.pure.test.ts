import { describe, expect, test } from 'vitest'
import {
  canExport,
  EXPORT_SCOPE,
  GRANTED_SCOPES,
  parseScopes,
  scopeText,
  UPLOAD_SCOPE,
} from './scope'

describe('the scope words of a connection', () => {
  test('F23-AC46: Given what the consent screen grants, When it is written as text and read back, Then the connection can export', () => {
    expect(scopeText(GRANTED_SCOPES)).toBe('slides:upload slides:export')
    expect(canExport(parseScopes(scopeText(GRANTED_SCOPES)))).toBe(true)
  })

  test('F23-AC47: Given the scope every connection had before the export tools, When it is read, Then it cannot export', () => {
    expect(parseScopes('slides:upload')).toEqual([UPLOAD_SCOPE])
    expect(canExport(parseScopes('slides:upload'))).toBe(false)
  })

  test.each([
    ['empty text', '', []],
    ['an unknown word', 'slides:admin', []],
    ['a word with other letters', 'Slides:Export', []],
    [
      'extra spaces and repeats',
      '  slides:export  slides:export ',
      [EXPORT_SCOPE],
    ],
    ['a known word beside an unknown one', 'slides:export x', [EXPORT_SCOPE]],
    [
      'the words in another order',
      'slides:export slides:upload',
      [UPLOAD_SCOPE, EXPORT_SCOPE],
    ],
    ['a word that only contains a scope', 'xslides:export', []],
  ])(
    'F23-AC47: Given %s, When it is read, Then it grants only what is known exactly',
    (_, text, expected) => {
      expect(parseScopes(text)).toEqual(expected)
    },
  )
})
