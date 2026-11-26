import { expect, test } from 'vitest'
import { sampleText, sampleTransmission } from '../legal/test-texts'
import { isIndexablePath, ROBOTS_TXT } from './indexing'

test('Given the top page or robots.txt, When checked, Then it may be indexed', () => {
  expect(isIndexablePath('/')).toBe(true)
  expect(isIndexablePath('/robots.txt')).toBe(true)
  expect(isIndexablePath('/help')).toBe(true)
  expect(isIndexablePath('/help/bot')).toBe(true)
})

test.each([
  '/help/start',
  '/help/slides',
  '/help/articles',
  '/help/sharing',
  '/help/community',
  '/help/agent',
  '/help/account',
  '/help/safety',
  '/help/start/sign-in',
  '/help/community/create-community',
])(
  'F36-AC22: Given the help page %s, When checked, Then it may be indexed',
  (path) => {
    expect(isIndexablePath(path)).toBe(true)
  },
)

test.each([
  '/help/',
  '/help/start/',
  '/help/START',
  '/help/start/Sign-In',
  '/help/start/a/b',
  '/help/start/a_b',
  '/help/start//x',
  '/help/bot/x',
  '/help/startx',
  '/help/start/-x',
  '/help#start',
])(
  'F36-AC22: Given the path %s, When checked, Then it is not a help page to index',
  (path) => {
    expect(isIndexablePath(path)).toBe(false)
  },
)

test.each([
  '/my/slides',
  '/my/slides/talk',
  '/my/communities',
  '/settings',
  '/api/slides',
  '/auth/github',
  '/uploads/x',
  '',
  '/missing',
  '/help/missing',
])('Given %j, When checked, Then it is not indexed', (path) => {
  expect(isIndexablePath(path)).toBe(false)
})

test('Given robots.txt, When read, Then every private prefix is disallowed and the top page is not', () => {
  const lines = ROBOTS_TXT.split('\n')
  expect(lines[0]).toBe('User-agent: *')
  for (const prefix of ['/api/', '/auth/', '/my/', '/settings', '/uploads/'])
    expect(lines).toContain(`Disallow: ${prefix}`)
  expect(lines).not.toContain('Disallow: /')
})

const legal = (terms: string, privacy: string, external: string) => ({
  terms: sampleText(terms),
  privacy: sampleText(privacy),
  external: sampleTransmission(external),
})

test.each(['/terms', '/privacy', '/privacy/external'])(
  'F34-AC9: Given the draft text at %s, When checked, Then it is not indexed',
  (path) => {
    expect(
      isIndexablePath(path, legal('(施行日)', '(施行日)', '(施行日)')),
    ).toBe(false)
  },
)

test.each(['/terms', '/privacy', '/privacy/external'])(
  'F34-AC11: Given the text at %s with a date, When checked, Then it may be indexed',
  (path) => {
    expect(
      isIndexablePath(path, legal('2026-12-01', '2026-12-01', '2026-12-01')),
    ).toBe(true)
  },
)

test('F34-AC12: Given only the privacy policy has a date, When the three paths are checked, Then only its path is indexed', () => {
  const given = legal('(施行日)', '2026-12-01', '(施行日)')
  expect(isIndexablePath('/terms', given)).toBe(false)
  expect(isIndexablePath('/privacy', given)).toBe(true)
  expect(isIndexablePath('/privacy/external', given)).toBe(false)
})

test('Given texts with dates, When a path next to a text is checked, Then it is not indexed', () => {
  const given = legal('2026-12-01', '2026-12-01', '2026-12-01')
  for (const path of ['/terms/', '/privacy/other', '/contact', '/Terms'])
    expect(isIndexablePath(path, given)).toBe(false)
})
