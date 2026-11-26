import { afterAll, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { DRAFT_NOTICE, DRAFT_SUFFIX } from '../legal/document-pages'
import { testEnv, TEST_ORIGIN } from '../publication/test-support'

/**
 * The texts the service carries are drafts today, so the finished state is
 * tried on a copy: the terms get a date, the other two texts stay as they are.
 */
vi.mock('../legal/documents', async (importOriginal) => {
  const original = await importOriginal<typeof import('../legal/documents')>()
  return {
    ...original,
    LEGAL_TEXTS: {
      ...original.LEGAL_TEXTS,
      terms: {
        ...original.LEGAL_TEXTS.terms,
        history: [{ date: '2026-12-01', summary: '制定' }],
      },
    },
  }
})

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
afterAll(() => platform.dispose())

const get = (path: string) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`), env)

test('F34-AC10, F34-AC11: Given the terms with a date, When they are requested, Then there is no (下書き), no notice and no noindex', async () => {
  const response = await get('/terms')
  const page = await response.text()
  expect(response.status).toBe(200)
  expect(page).toContain('<h1>利用規約</h1>')
  expect(page).not.toContain(DRAFT_SUFFIX)
  expect(page).not.toContain(DRAFT_NOTICE)
  expect(response.headers.get('X-Robots-Tag')).toBeNull()
})

test('F34-AC12: Given only the terms have a date, When the other two texts are requested, Then they are still drafts with a notice and noindex', async () => {
  for (const [path, title] of [
    ['/privacy', 'プライバシーポリシー'],
    ['/privacy/external', '外部への送信'],
  ] as const) {
    const response = await get(path)
    const page = await response.text()
    expect(page).toContain(`<h1>${title}${DRAFT_SUFFIX}</h1>`)
    expect(page).toContain(DRAFT_NOTICE)
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  }
})

test('F34-AC11: Given a path under a text with a date that is no page, When it is requested, Then it is not listed', async () => {
  const response = await get('/terms/missing')
  expect(response.status).toBe(404)
  expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
})
