import { expect, test } from 'vitest'
import { RESERVED_HANDLES } from '../auth/handle-rules'
import {
  LEGAL_TEXT_KINDS,
  LEGAL_TEXT_PATHS,
  indexableLegalPaths,
} from './documents'
import { sampleText, sampleTransmission } from './test-texts'

const texts = (terms: string, privacy: string, external: string) => ({
  terms: sampleText(terms),
  privacy: sampleText(privacy),
  external: sampleTransmission(external),
})

test('F34-AC9: Given three drafts, When the listable paths are asked, Then there are none', () => {
  expect(
    indexableLegalPaths(texts('(施行日)', '(施行日)', '(施行日)')).size,
  ).toBe(0)
})

test('F34-AC11: Given three texts with dates, When the listable paths are asked, Then all three are', () => {
  expect([
    ...indexableLegalPaths(texts('2026-12-01', '2026-12-01', '2026-12-01')),
  ]).toEqual(['/terms', '/privacy', '/privacy/external'])
})

test.each([
  ['terms', texts('2026-12-01', '(施行日)', '(施行日)'), ['/terms']],
  ['privacy', texts('(施行日)', '2026-12-01', '(施行日)'), ['/privacy']],
  [
    'external',
    texts('(施行日)', '(施行日)', '2026-12-01'),
    ['/privacy/external'],
  ],
] as const)(
  'F34-AC12: Given only the %s text has a date, When the listable paths are asked, Then only its path is',
  (_kind, given, expected) => {
    expect([...indexableLegalPaths(given)]).toEqual(expected)
  },
)

test('F34-AC24: Given the legal paths, When their first word is checked, Then no one may take it as a handle', () => {
  for (const kind of LEGAL_TEXT_KINDS) {
    const first = LEGAL_TEXT_PATHS[kind].split('/')[1] ?? ''
    expect(RESERVED_HANDLES.has(first)).toBe(true)
  }
})

test('D-23: Given the three texts, When their paths are read, Then they are /terms, /privacy and /privacy/external', () => {
  expect(LEGAL_TEXT_PATHS).toEqual({
    terms: '/terms',
    privacy: '/privacy',
    external: '/privacy/external',
  })
})
