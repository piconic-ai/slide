import { expect, test } from 'vitest'
import { japaneseOutside } from '../site/test-japanese'
import { HEADER_MARKER, maintenanceBand } from './notice-band'

const notice = {
  startsAt: Date.UTC(2026, 11, 1, 3, 0) / 1000,
  endsAt: Date.UTC(2026, 11, 1, 6, 0) / 1000,
  reason: 'database',
} as const

const draw = async (lang: 'ja' | 'en' = 'ja', help = '/help') =>
  String(await maintenanceBand(notice, lang, help))

test('F38-AC2 F38-AC27: Given a plan, When the band is drawn, Then it says from when to when in Japan time, in <time> elements with the moments in UTC', async () => {
  const band = await draw()
  expect(band).toMatch(
    /<time datetime="2026-12-01T03:00:00Z"\s*>2026年12月1日 12:00<\/time\s*>から/,
  )
  expect(band).toMatch(
    /<time datetime="2026-12-01T06:00:00Z"\s*>2026年12月1日 15:00<\/time\s*>まで/,
  )
  expect(band).toContain('から')
  expect(band).toContain(
    'まで(日本時間)、メンテナンスのためサービスを止めます。',
  )
})

test('F38-AC27: Given the band, When drawn, Then it is a status', async () => {
  const band = await draw()
  expect(band).toContain('role="status"')
  expect(band.match(/role="status"/g)).toHaveLength(1)
})

test('F38-AC3: Given the band, When drawn, Then it has no button, no close control and no script', async () => {
  const band = await draw()
  expect(band).not.toMatch(
    /<button|<script|type="button"|aria-label="[^"]*(閉じる|close)/i,
  )
  expect(band).not.toContain('onclick')
})

test('F38-AC2: Given the path of the help, When the band is drawn, Then it links there and nowhere else', async () => {
  const band = await draw('ja', '/help/safety/maintenance')
  expect(band.match(/<a /g)).toHaveLength(1)
  expect(band).toContain('href="/help/safety/maintenance"')
})

test('F38-AC27: Given the band, When drawn, Then its link is at least 44px tall and it uses the color blocks of the design, not a raw color', async () => {
  const band = await draw()
  expect(band).toMatch(/\.maintenance-band a \{[^}]*min-height: 44px/)
  expect(band).toContain('var(--block-yellow)')
  expect(band).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
})

test('F38-AC28: Given the English screen, When the band is drawn, Then it is English throughout, with the moments in JST', async () => {
  const band = await draw('en')
  expect(band).toContain('We will stop the service for maintenance from')
  expect(band).toContain('Dec 1, 2026, 12:00 JST')
  expect(band).toContain('Dec 1, 2026, 15:00 JST')
  expect(band).toContain('Details in the Help')
  expect(japaneseOutside(band)).toEqual([])
})

test('Given the marker, When compared with the header of the pages, Then it is the header that every page draws', async () => {
  const { siteHeader } = await import('../site/header')
  expect(String(await siteHeader('ja'))).toContain(HEADER_MARKER)
  expect(String(await siteHeader('en', 'none'))).toContain(HEADER_MARKER)
})
