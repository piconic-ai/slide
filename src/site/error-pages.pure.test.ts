import { expect, test } from 'vitest'
import { japaneseOutside } from './test-japanese'
import { errorJson, errorPage, errorStatus, loggedPath } from './error-pages'

test.each([
  ['not_found', 404],
  ['server_error', 500],
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
  expect(page).toContain('URL が正しいか確かめてください。')
  expect(page).toContain('color-block-ecru')
  expect(page).toContain('max-width: 640px')
  // The brand in the shared header, then the way back in the page itself.
  expect(page.match(/href="\/"/g)).toEqual(['href="/"', 'href="/"'])
  expect(page).toContain('href="/missing?lang=en"')
})

test.each(['not_found', 'server_error'] as const)(
  'Given the %s page in English, When rendered, Then it is English throughout',
  async (kind) => {
    const page = String(await errorPage(kind, 'en', url))
    expect(page).toContain('<html lang="en">')
    expect(japaneseOutside(page)).toEqual([])
  },
)

test.each([
  ['/mcp/files/abc.def', '/mcp/files/:value'],
  ['/mcp/files/', '/mcp/files/:value'],
  ['/mcp/files/a/b', '/mcp/files/:value'],
  ['/mcp', '/mcp'],
  ['/mcp/filesystem', '/mcp/filesystem'],
  ['/my/slides/talk', '/my/slides/talk'],
])(
  'F35-AC41: Given the path %s, When an error is logged, Then it is named as %s',
  (path, logged) => {
    expect(loggedPath(path)).toBe(logged)
  },
)
