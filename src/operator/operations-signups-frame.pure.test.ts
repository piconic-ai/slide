import { expect, test } from 'vitest'
import { readyView } from './operations-maintenance-frame'
import { operationsPage, type OperationsView } from './operations-pages'
import { signupsFrame, type SignupsFrameView } from './operations-signups-frame'

const running: SignupsFrameView = {
  kind: 'ready',
  mode: 'invitation',
  pausedSince: null,
  lastHour: 3,
  lastDay: 41,
}
const draw = (view: SignupsFrameView) => String(signupsFrame(view))

test('F42-AC11: Given an invite-only service, When the frame is drawn, Then it says so, says the value cannot be changed here, and counts the last hour and the last 24 hours', () => {
  const page = draw(running)
  expect(page).toContain('<section id="signups">')
  expect(page).toContain('<h2>新しい登録</h2>')
  expect(page).toMatch(/<dd>\s*招待制\s*<\/dd>/)
  expect(page).toContain('OPEN_SIGNUP')
  expect(page).toContain('この画面では変えられません')
  expect(page).toContain('<dt>直近 1 時間の登録</dt>')
  expect(page).toContain('<dd>3 人</dd>')
  expect(page).toContain('<dt>直近 24 時間の登録</dt>')
  expect(page).toContain('<dd>41 人</dd>')
})

test('F42-AC11: Given an open service, When the frame is drawn, Then it says sign-up is open', () => {
  expect(draw({ ...running, mode: 'open' })).toContain(
    '開いている(招待なしで登録できる)',
  )
})

test('F42-AC12, F42-AC15: Given sign-up going on, When the frame is drawn, Then it offers to stop and not to resume, and the other way round when it is stopped', () => {
  const going = draw(running)
  expect(going).toContain('受け付けている')
  expect(going).toContain('action="/operations/signups/pause"')
  expect(going).toContain('新しい登録を止める</button>')
  expect(going).not.toContain('再開する')
  const stopped = draw({ ...running, pausedSince: 1_700_000_000 })
  expect(stopped).toContain('止めている(')
  expect(stopped).toContain('2023-11-14T22:13:20.000Z')
  expect(stopped).toContain('action="/operations/signups/resume"')
  expect(stopped).toContain('再開する</button>')
  expect(stopped).not.toContain('新しい登録を止める')
})

test.each([
  ['going', running],
  ['stopped', { ...running, pausedSince: 5 }],
] as const)(
  'F42-AC16: Given the frame while it is %s, When it is drawn, Then its one button is the last thing in it, alone, with nothing after the form',
  (_, view) => {
    const page = draw(view)
    expect(page.match(/<button/g)).toHaveLength(1)
    const afterForm = page.slice(page.indexOf('</form>') + '</form>'.length)
    expect(afterForm.replace(/\s+/g, '')).toBe('</section>')
    // Nothing that can be pressed comes before it.
    expect(page.slice(0, page.indexOf('<form'))).not.toMatch(
      /<button|<a |<input/,
    )
  },
)

test('F42-AC16: Given the page, When the frames are drawn together, Then the frame of new sign-ups sits second and is no longer a placeholder', async () => {
  const views: OperationsView = {
    operator: { email: 'op@example.com' },
    maintenance: readyView(null, false),
    signups: running,
    email: { kind: 'not_configured' },
    backups: { kind: 'not_configured' },
    alerts: { kind: 'not_configured', recent: [] },
  }
  const page = String(await operationsPage(views))
  const at = page.indexOf('<h2>新しい登録</h2>')
  expect(at).toBeGreaterThan(page.indexOf('<h2>メンテナンスの予定</h2>'))
  expect(at).toBeLessThan(page.indexOf('<h2>メールアドレスの暗号化</h2>'))
  const frame = page.slice(at, page.indexOf('</section>', at))
  expect(frame).not.toContain('準備中です')
})
