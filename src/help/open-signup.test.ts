import { afterAll, describe, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { testEnv, TEST_ORIGIN } from '../publication/test-support'
import { catalogFor } from './catalog'
import { HELP_CATALOG } from './default-catalog'
import { helpNumbers } from './numbers'

const platform = await getPlatformProxy<Env>({ persist: false })
const closed = testEnv(platform.env)
const open = { ...closed, OPEN_SIGNUP: 'on' } as Env
afterAll(() => platform.dispose())

const get = (path: string, vars: Env) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`), vars)

const SPEAKS_OF_INVITATION = /招待|invit/i

const open_catalog = catalogFor(HELP_CATALOG, 'open')

describe('the help while sign-up is open', () => {
  test('F42-AC5: Given the articles of the help, When sign-up is open, Then no article in either language speaks of an invitation', async () => {
    const numbers = helpNumbers('open')
    for (const entry of open_catalog)
      for (const lang of ['ja', 'en'] as const) {
        const { title, lead, body } = entry.article[lang]
        const text = `${title} ${String(await lead(numbers))} ${String(await body(numbers))}`
        expect(text, `${entry.key} ${lang}`).not.toMatch(SPEAKS_OF_INVITATION)
      }
  })

  test('F42-AC5: Given the article about invitations, When sign-up is open, Then it is not in the help and its page is gone', async () => {
    expect(open_catalog.map((entry) => entry.key)).not.toContain(
      'start/invitation-only',
    )
    expect(
      HELP_CATALOG.some((entry) => entry.key === 'start/invitation-only'),
    ).toBe(true)
    expect((await get('/help/start/invitation-only', open)).status).toBe(404)
    expect((await get('/help/start/invitation-only', closed)).status).toBe(200)
  })

  test('F42-AC5: Given the pages of the help, When sign-up is open, Then no list, article or search result speaks of an invitation, and when it is invite-only the same pages do', async () => {
    const pages = [
      '/help',
      '/help/start',
      '/help/start/sign-in',
      '/help/start/code-not-arrived',
      '/help/slides/upload',
      '/help/agent/capabilities',
      '/help?q=zip',
    ]
    for (const lang of ['ja', 'en'])
      for (const path of pages) {
        const join = path.includes('?') ? '&' : '?'
        const openText = await (
          await get(`${path}${join}lang=${lang}`, open)
        ).text()
        expect(openText, `${path} ${lang}`).not.toMatch(SPEAKS_OF_INVITATION)
      }
    const closedText = await (
      await get('/help/slides/upload?lang=en', closed)
    ).text()
    expect(closedText).toMatch(/invite-only/)
  })

  test('F42-AC5: Given a search for the word invitation, When sign-up is open, Then no article about invitations is found', async () => {
    const response = await get('/help?q=%E6%8B%9B%E5%BE%85', open)
    expect(response.status).toBe(200)
    expect(await response.text()).not.toContain('/help/start/invitation-only')
    const closedPage = await get('/help?q=%E6%8B%9B%E5%BE%85', closed)
    expect(await closedPage.text()).toContain('/help/start/invitation-only')
  })
})
