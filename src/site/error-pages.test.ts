import { expect, test } from 'vitest'
import { japaneseOutside } from './test-japanese'
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

const url = new URL('https://slide.example/missing')

test('Given an error page in Japanese, When rendered, Then it is a Japanese page linking to the top', async () => {
  const page = String(await errorPage('not_found', 'ja', url))
  expect(page).toContain('<html lang="ja">')
  expect(page).toContain('ページが見つかりません')
  expect(page).toContain('href="/"')
  expect(page).toContain('href="/missing?lang=en"')
})

test.each(['not_found', 'server_error', 'maintenance'] as const)(
  'Given the %s page in English, When rendered, Then it is English throughout',
  async (kind) => {
    const page = String(await errorPage(kind, 'en', url))
    expect(page).toContain('<html lang="en">')
    expect(japaneseOutside(page)).toEqual([])
  },
)

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
