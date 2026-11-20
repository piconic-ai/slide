import { expect, test } from 'vitest'
import { landingOf } from './landing'

test('Given the settings destination, When sign-in chooses a landing, Then it returns to settings', () => {
  expect(landingOf('settings')).toBe('/settings')
})

test('F22-AC10: Given the top page as the destination, When sign-in chooses a landing, Then it returns to the top page, where a kept file is received', () => {
  expect(landingOf('top')).toBe('/')
  expect(landingOf('top', '9d0b6a51-7c1e-4f55-8a43-5e2f1b7c9a10')).toBe(
    '/?drop=9d0b6a51-7c1e-4f55-8a43-5e2f1b7c9a10',
  )
  expect(landingOf('top', '//evil.example')).toBe('/')
  // The token belongs to the top page only.
  expect(landingOf('settings', '9d0b6a51-7c1e-4f55-8a43-5e2f1b7c9a10')).toBe(
    '/settings',
  )
})

test.each(['/', 'Top', 'top/', '//evil.example', 'https://evil.example/'])(
  'Given %j, which only looks like the top page, When sign-in chooses a landing, Then it falls back to slides',
  (to) => {
    expect(landingOf(to)).toBe('/slides')
  },
)

test('F21-AC1: Given a canonical profile path, When sign-in chooses a landing, Then it returns to the author’s profile', () => {
  expect(landingOf('/@owner')).toBe('/@owner')
})

test.each(['/@owner/talk', '/@owner/talk/1', '/@owner/talk/9999'])(
  'F17-AC18: Given the share path %s, When sign-in chooses a landing, Then it returns to that slide',
  (path) => {
    expect(landingOf(path)).toBe(path)
  },
)

test.each([
  undefined,
  '',
  'slides',
  '/settings',
  '/reports/new',
  '/@Owner',
  '/%40owner',
  '/@owner/',
  '/@owner/talk/0',
  '/@owner/talk/10000',
  '/@owner/talk/01',
  '/@owner/talk/',
  '/@Owner/Talk',
  '/@owner/talk?next=elsewhere',
  '/@owner/talk#page',
  'https://example.com/@owner/talk',
  '//example.com/@owner/talk',
  '\\example.com\\@owner\\talk',
  '/\\example.com/@owner/talk',
  '/@owner/talk\\elsewhere',
  '/%40owner/talk',
  '/@owner/t%61lk',
  '/@owner%2ftalk/other',
  '/%2fexample.com/@owner/talk',
  '/@owner/%2e%2e',
  '/@owner/%252e%252e',
  '/@owner/talk%00',
  '/@owner/%',
])(
  'F17-AC18: Given disallowed destination %j, When sign-in chooses a landing, Then it falls back to slides',
  (path) => {
    expect(landingOf(path)).toBe('/slides')
  },
)

test('Given a sign-in an agent’s connection started, When sign-in chooses a landing, Then it returns to the authorization page', () => {
  expect(landingOf('agent')).toBe('/oauth/authorize')
})
