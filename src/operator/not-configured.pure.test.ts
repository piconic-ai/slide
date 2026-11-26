import { expect, test } from 'vitest'
import { notConfigured, pendingNote } from './not-configured'

test('Given one missing name, When drawn, Then it names the name and the document in one status paragraph', async () => {
  const out = String(
    await notConfigured(['DISCORD_WEBHOOK_URL'], 'docs/dev/alerts.md'),
  )
  expect(out).toContain('role="status"')
  expect(out).toContain('<code>DISCORD_WEBHOOK_URL</code>')
  expect(out).toContain('<code>docs/dev/alerts.md</code>')
  expect(out).toContain('未設定')
  expect(out.match(/<p /g)).toHaveLength(1)
})

test('Given several missing names, When drawn, Then every name shows once and they are separated', async () => {
  const out = String(await notConfigured(['A_ONE', 'B_TWO', 'C_THREE'], 'd.md'))
  for (const name of ['A_ONE', 'B_TWO', 'C_THREE'])
    expect(out.split(`<code>${name}</code>`)).toHaveLength(2)
  expect(out).toContain('</code>、<code>')
})

test('Given names or a path with markup, When drawn, Then the markup is escaped', async () => {
  const out = String(
    await notConfigured(
      ['<script>alert(1)</script>'],
      '"><img src=x onerror=1>',
    ),
  )
  expect(out).not.toContain('<script>')
  expect(out).not.toContain('<img')
  expect(out).toContain('&lt;script&gt;')
})

test('Given a frame not built yet, When its note is drawn, Then it is one line saying so', async () => {
  expect(String(await pendingNote())).toContain('準備中です。')
})
