import { expect, test } from 'vitest'
import { emailFrame, type EmailFrameView } from './operations-email-frame'

const draw = async (view: EmailFrameView) => String(await emailFrame(view))
const ready = (
  counts = { plain: 3, olderVersion: 2, current: 5 },
): EmailFrameView => ({
  kind: 'ready',
  versions: [1, 2],
  current: 2,
  counts,
})

test('F41-AC13: Given no keys, When the frame is drawn, Then it says not set, names the three settings and the guide, right under the heading, and has no button', async () => {
  const out = await draw({ kind: 'not_configured' })
  expect(out.indexOf('<h2>メールアドレスの暗号化</h2>')).toBeLessThan(
    out.indexOf('未設定'),
  )
  for (const name of [
    'EMAIL_CIPHER_KEYS',
    'EMAIL_CIPHER_CURRENT',
    'EMAIL_LOOKUP_KEY',
    'docs/dev/email-encryption-runbook.md',
  ])
    expect(out).toContain(`<code>${name}</code>`)
  expect(out).not.toContain('<button')
})

test('F41-AC10: Given keys that fit, When the frame is drawn, Then it shows the key versions and the counts, and the button is the last thing', async () => {
  const out = await draw(ready())
  expect(out).toContain('設定済み')
  expect(out).toContain('版 1、2')
  expect(out).toMatch(/平文の行\(残り\)<\/dt>\s*<dd>3 件/)
  expect(out).toMatch(/古い版で暗号化した行<\/dt>\s*<dd>2 件/)
  expect(out).toMatch(/いまの版で暗号化した行<\/dt>\s*<dd>5 件/)
  expect(out.match(/<button/g)).toHaveLength(1)
  expect(out.indexOf('<button')).toBeGreaterThan(out.indexOf('<dl>'))
  expect(out.slice(out.indexOf('</button>'))).not.toContain('<dd>')
  expect(out).toContain('action="/operations/email/rewrite"')
})

test('F41-AC8: Given nothing left to rewrite, When the frame is drawn, Then it says so and has no button', async () => {
  const out = await draw(ready({ plain: 0, olderVersion: 0, current: 7 }))
  expect(out).toContain('書き換える行はありません')
  expect(out).not.toContain('<button')
})

test('F41-AC14: Given keys that are not usable, When the frame is drawn, Then it names what is wrong and never a value', async () => {
  const out = await draw({
    kind: 'invalid',
    problems: ['current_unknown', 'lookup_reused'],
  })
  expect(out).toContain('EMAIL_CIPHER_CURRENT')
  expect(out).toContain('暗号の鍵と同じ')
  expect(out).not.toContain('<button')
})

test('F41-AC14: Given keys that do not fit the data, When the frame is drawn, Then it says so and offers no rewrite', async () => {
  const out = await draw({ kind: 'mismatch' })
  expect(out).toContain('合いません')
  expect(out).not.toContain('<button')
})
