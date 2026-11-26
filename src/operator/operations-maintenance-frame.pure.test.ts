import { expect, test } from 'vitest'
import {
  maintenanceFrame,
  NOTICE_RESULTS,
  parseNoticeResult,
  readyView,
  type MaintenanceFrameView,
} from './operations-maintenance-frame'

const notice = {
  startsAt: Date.UTC(2026, 11, 1, 3, 0) / 1000,
  endsAt: Date.UTC(2026, 11, 1, 6, 0) / 1000,
  reason: 'database',
} as const

const draw = async (view: MaintenanceFrameView) =>
  String(await maintenanceFrame(view))

test('F38-AC8: Given the frame, When drawn, Then it has the heading, the three inputs, both buttons and the link to the steps, in this order', async () => {
  const frame = await draw(readyView(null, false))
  const order = [
    '<h2>メンテナンスの予定</h2>',
    'いま出している予告',
    '>開始の見込み</label',
    '>終了の見込み</label',
    '>理由の区分</label',
    '予告を出す</button',
    '予告を消す</button',
    'メンテナンス作業-n',
  ].map((text) => frame.indexOf(text))
  expect(order.every((at) => at > 0)).toBe(true)
  expect(order).toEqual([...order].sort((a, b) => a - b))
  expect(frame.match(/<input\s/g)).toHaveLength(2)
  expect(frame.match(/type="datetime-local"/g)).toHaveLength(2)
  expect(frame.match(/<select\s/g)).toHaveLength(1)
  expect(frame).toContain('action="/operations/maintenance"')
  expect(frame).toContain('action="/operations/maintenance/clear"')
})

test('F38-AC8: Given a plan, When the frame is drawn, Then it says from when to when in Japan time, the reason, and whether the band is out', async () => {
  const shown = await draw(readyView(notice, true))
  expect(shown).toContain('2026年12月1日 12:00')
  expect(shown).toContain('2026年12月1日 15:00')
  expect(shown).toContain('データベースの保守')
  expect(shown).toContain('全ページの上に帯が出ています。')
  const past = await draw(readyView(notice, false))
  expect(past).toContain('終了の見込みを過ぎているので、帯は出ていません。')
  expect(await draw(readyView(null, false))).toContain(
    '出している予告はありません。',
  )
})

test('F38-AC7: Given each result, When the frame is drawn, Then it is said once, and only the short-notice one is a warning', async () => {
  for (const result of NOTICE_RESULTS) {
    const frame = await draw({ ...readyView(null, false), result })
    expect(frame.match(/role="status"/g)).toHaveLength(1)
    expect(frame.includes('notice-warning')).toBe(result === 'saved_soon')
  }
  expect(
    await draw({ ...readyView(null, false), result: 'saved_soon' }),
  ).toContain('開始まで 3 日を切っています')
})

test('F38-AC1: Given a problem, When the frame is drawn, Then it is under the field to fix, as an alert, and what was typed is kept', async () => {
  const frame = await draw({
    ...readyView(null, false),
    form: {
      startsAt: '2026-12-01T12:00',
      endsAt: '2026-12-01T11:00',
      reason: 'update',
    },
    problem: 'order',
  })
  const at = frame.indexOf('終了の見込みを、開始の見込みより後にしてください。')
  expect(at).toBeGreaterThan(frame.indexOf('name="ends_at"'))
  expect(at).toBeLessThan(frame.indexOf('>理由の区分</label'))
  expect(frame.match(/role="alert"/g)).toHaveLength(1)
  expect(frame).toContain('value="2026-12-01T12:00"')
  expect(frame).toContain('value="2026-12-01T11:00"')
  expect(frame).toMatch(/<option\s+value="update"\s+selected/)
})

test('F38-AC1: Given text with markup typed into a field, When the frame is drawn, Then it is escaped', async () => {
  const frame = await draw({
    ...readyView(null, false),
    form: { startsAt: '"><b>x</b>', endsAt: '', reason: '<i>' },
    problem: 'starts_at',
  })
  expect(frame).not.toContain('<b>x</b>')
  expect(frame).not.toContain('<i>')
  expect(frame).toContain('&quot;&gt;&lt;b&gt;x&lt;/b&gt;')
})

test.each([
  ['saved', 'saved'],
  ['saved_soon', 'saved_soon'],
  ['cleared', 'cleared'],
  ['nothing_to_clear', 'nothing_to_clear'],
  ['evil', null],
  ['', null],
  [undefined, null],
  [['saved'], null],
])(
  'Given %j in the address, When the result is read, Then it is %j',
  (value, result) => {
    expect(parseNoticeResult(value)).toBe(result)
  },
)

test('Given the frame, When drawn, Then it holds no raw color', async () => {
  expect(await draw(readyView(notice, true))).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
})
