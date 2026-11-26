import { expect, test } from 'vitest'
import { TARGET_NAMES } from './watch-config'
import { endText, maintenanceMessageOf, messageOf } from './watch-text'

test.each(TARGET_NAMES)(
  'F39-AC14: Given the address %s down, When the message is made, Then it names it, the failures and the steps, and holds no address of a page',
  (target) => {
    const text = messageOf('down', target, 2)
    expect(text).toContain('ページが開けません')
    expect(text).toContain('2 回続けて')
    expect(text).toContain('docs/dev/alerts-runbook.md#page-unreachable')
    expect(text).not.toMatch(/https?:|@|\d+\.\d+\.\d+\.\d+/)
  },
)

test('F39-AC15: Given an address back, When the message is made, Then it says it is open again', () => {
  expect(messageOf('recovered', 'viewer', 0)).toContain(
    'ページが開けるようになりました: viewer',
  )
})

const END = Date.UTC(2026, 11, 1, 3, 0, 0) / 1000

test.each([
  ['started', 'メンテナンスが始まりました'],
  ['overrun', 'メンテナンスが終わる見込みを過ぎています'],
  ['ended', 'メンテナンスが終わりました'],
] as const)(
  'F38-AC25 F38-AC26: Given maintenance %s, When the message is made, Then it names what happened, the expected end in Japan time and UTC, and the steps',
  (phase, title) => {
    const text = maintenanceMessageOf(phase, END)
    expect(text.split('\n')).toEqual([
      `[slide 見張り] ${title}`,
      '終わる見込み: 2026-12-01 12:00 JST(03:00 UTC)',
      '手順: docs/dev/alerts-runbook.md#maintenance',
    ])
  },
)

test('F38-AC25: Given no expected end, When the message is made, Then it has no line of it', () => {
  expect(maintenanceMessageOf('started', null)).toBe(
    '[slide 見張り] メンテナンスが始まりました\n手順: docs/dev/alerts-runbook.md#maintenance',
  )
})

test.each([
  [Date.UTC(2026, 11, 31, 15, 30) / 1000, '2027-01-01 00:30 JST(15:30 UTC)'],
  [Date.UTC(2026, 11, 1, 0, 0) / 1000, '2026-12-01 09:00 JST(00:00 UTC)'],
])(
  'F38-AC26: Given a moment near a day boundary, When it is written, Then the date rolls over with Japan time',
  (seconds, text) => {
    expect(endText(seconds)).toBe(text)
  },
)

test('D-58: Given any message of maintenance, When it is made, Then it holds no address, no name and nothing a request carried', () => {
  for (const phase of ['started', 'overrun', 'ended'] as const)
    expect(maintenanceMessageOf(phase, END)).not.toMatch(
      /https?:|@|\d+\.\d+\.\d+\.\d+/,
    )
})
