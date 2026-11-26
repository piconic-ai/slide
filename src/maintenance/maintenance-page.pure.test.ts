import { expect, test } from 'vitest'
import { japaneseOutside } from '../site/test-japanese'
import { maintenancePage } from './maintenance-page'

const url = new URL('https://slide.example/slides')
const until = Date.UTC(2026, 11, 1, 3, 0, 0) / 1000
const render = async (
  view: Parameters<typeof maintenancePage>[0],
  lang: 'ja' | 'en' = 'ja',
) => String(await maintenancePage(view, lang, url))

test('F38-AC9: Given an end and a reason, When the page is drawn, Then the title, the end in Japan time and UTC, and the reason come in this order, before the links', async () => {
  const page = await render({ until, reason: 'database' })
  const at = (text: string) => page.indexOf(text)
  expect(at('メンテナンス中です')).toBeGreaterThan(0)
  expect(page).toContain('<time datetime="2026-12-01T03:00:00Z"')
  expect(page).toContain('2026年12月1日 12:00')
  expect(page).toContain('2026-12-01 03:00 UTC')
  expect(page).toContain('ごろに終わる見込みです')
  const order = [
    'メンテナンス中です',
    '終わる見込みです',
    'データベースの保守のため',
    '読めるページ',
  ].map(at)
  expect(order).toEqual([...order].sort((a, b) => a - b))
  expect(order.every((i) => i > 0)).toBe(true)
})

test('F38-AC10: Given no end, When the page is drawn, Then no time is shown', async () => {
  const page = await render({ until: null, reason: 'update' })
  expect(page).not.toContain('<time')
  expect(page).not.toContain('見込み')
  expect(page).not.toContain('UTC')
  expect(page).toContain('サービスの更新のため')
})

test('Given neither an end nor a reason, When the page is drawn, Then it is the title, the message and the links', async () => {
  const page = await render({ until: null, reason: null })
  expect(page).toContain('メンテナンス中です')
  expect(page).toContain('しばらくしてから')
  expect(page).not.toContain('のため、サービスを止めています')
})

test('F38-AC12: Given the page, When drawn, Then it links to the help, the terms, the privacy policy and the contact page', async () => {
  const page = await render({ until: null, reason: null })
  for (const href of ['/help', '/terms', '/privacy', '/contact'])
    expect(page).toContain(`href="${href}"`)
})

test('F38-AC28: Given the page in English, When drawn, Then it is English throughout, with the end in JST and UTC', async () => {
  const page = await render({ until, reason: 'other' }, 'en')
  expect(page).toContain('<html lang="en">')
  expect(page).toContain('Under maintenance')
  expect(page).toContain('Dec 1, 2026, 12:00 JST')
  expect(page).toContain('2026-12-01 03:00 UTC')
  expect(page).toContain('The service is stopped for other work.')
  expect(japaneseOutside(page)).toEqual([])
})

test('Given the page, When drawn, Then the links are tall enough to press', async () => {
  expect(await render({ until: null, reason: null })).toMatch(
    /\.maintenance-links a \{[^}]*min-height: 44px/,
  )
})
