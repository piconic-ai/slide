import { expect, test } from 'vitest'
import { landingOf } from './landing'

test('Given the settings destination, When sign-in chooses a landing, Then it returns to settings', () => {
  expect(landingOf('settings')).toBe('/settings')
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
  '/@owner',
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
