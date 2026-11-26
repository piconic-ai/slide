import { expect, test } from 'vitest'
import { TARGET_NAMES } from './watch-config'
import { messageOf } from './watch-text'

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
