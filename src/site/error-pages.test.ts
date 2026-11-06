import { expect, test } from 'vitest'
import { errorJson, errorPage, errorStatus, isMaintenance } from './error-pages'

test.each([
  ['not_found', 404],
  ['server_error', 500],
  ['maintenance', 503],
] as const)(
  'Given %s, When answered, Then the status is %i',
  (kind, status) => {
    expect(errorStatus(kind)).toBe(status)
    expect(errorJson(kind).code).toBe(kind)
  },
)

test('Given an error page, When rendered, Then it is a Japanese page linking to the top', async () => {
  const page = String(await errorPage('not_found'))
  expect(page).toContain('<html lang="ja">')
  expect(page).toContain('ページが見つかりません')
  expect(page).toContain('href="/"')
})

test.each([
  ['on', true],
  [undefined, false],
  ['', false],
  ['off', false],
  ['true', false],
  ['ON', false],
  [' on', false],
] as const)(
  'Given MAINTENANCE=%j, When checked, Then maintenance is %s',
  (value, on) => {
    expect(isMaintenance(value)).toBe(on)
  },
)
