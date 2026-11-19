import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { testEnv, TEST_ORIGIN } from '../publication/test-support'
import { HELP_PAGE_POLICY } from './help-page'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
afterAll(() => platform.dispose())

const get = (path: string, vars: Env = env) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`), vars)

test('F17-AC5: Given a reader, When the help is requested, Then it explains what every slide can and cannot do and may be indexed', async () => {
  const response = await get('/help')
  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Security-Policy')).toBe(HELP_PAGE_POLICY)
  expect(response.headers.get('X-Robots-Tag')).toBeNull()
  expect(response.headers.get('Link')).toContain(
    `<${TEST_ORIGIN}/help?lang=en>; rel="alternate"; hreflang="en"`,
  )
  const page = await response.text()
  expect(page).toContain('<h1>ヘルプ</h1>')
  expect(page).toContain('max-width: 720px')
  expect(page).toContain('line-height: 1.9')
  expect(page).toContain('<section id="safety">')
  expect(page).toContain('別のタブやウィンドウを開く')
  expect(page).toContain('スライドは外部と通信できます。')
  // Nothing is listed per slide, so nothing explains how to read a list.
  expect(page).not.toContain('通信先」の読み方')
  expect(page).toContain('パスワードを入力しないでください。')
})

test('Given a reader who reads English, When the help is requested, Then it is in English', async () => {
  const page = await (await get('/help?lang=en')).text()
  expect(page).toContain('<html lang="en">')
  expect(page).toContain('<h1>Help</h1>')
  expect(page).toContain('<section id="safety">')
  expect(page).toContain('Opening other tabs or windows')
  expect(page).toContain('Slides can talk to other sites.')
  expect(page).toContain('do not type your password')
  expect(page).not.toContain('別のタブ')
})

test('Given maintenance, When the help is requested, Then it is still served', async () => {
  const response = await get('/help', { ...env, MAINTENANCE: 'on' } as Env)
  expect(response.status).toBe(200)
  expect(await response.text()).toContain('<h1>ヘルプ</h1>')
})

test('Given a path under the help that does not exist, When it is requested, Then it is not found', async () => {
  expect((await get('/help/missing')).status).toBe(404)
})
