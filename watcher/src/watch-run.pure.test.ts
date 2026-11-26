import { expect, test, vi } from 'vitest'
import { runChecks, type RunDeps } from './watch-run'
import { TARGET_NAMES, parseSettings } from './watch-config'
import type { Observation } from './watch-step'
import type { WebhookUrl } from './webhook-url'

const targets = {
  top: 'https://slide.example/',
  viewer: 'https://slide.example/@h/s',
  content: 'https://d-x.content.example/',
}
const WEBHOOK = 'https://discord.com/api/webhooks/1/token' as WebhookUrl

function deps(over: Partial<RunDeps> = {}) {
  const lines: Record<string, unknown>[] = []
  const posted: string[] = []
  const base: RunDeps = {
    targets,
    settings: parseSettings({}),
    webhook: WEBHOOK,
    now: 1000,
    observe: vi.fn(async () => 'ok' as Observation),
    observed: vi.fn(async () => ({ action: null, failures: 0 })),
    unsent: vi.fn(async () => {}),
    post: vi.fn(async (text: string) => {
      posted.push(text)
      return true
    }),
    log: (line) => lines.push(line),
  }
  return { deps: { ...base, ...over }, lines, posted }
}

test('F39-AC12: Given the three addresses, When a run is made, Then each is checked once, by its own address', async () => {
  const { deps: d } = deps()
  await runChecks(d)
  expect(
    (d.observe as ReturnType<typeof vi.fn>).mock.calls
      .map(([url]) => url)
      .sort(),
  ).toEqual(Object.values(targets).sort())
  expect(
    (d.observed as ReturnType<typeof vi.fn>).mock.calls
      .map(([name]) => name)
      .sort(),
  ).toEqual([...TARGET_NAMES].sort())
})

test('F39-AC13: Given checks that fail without reaching the count, When a run is made, Then each failure is logged by its address name and nothing is posted', async () => {
  const {
    deps: d,
    lines,
    posted,
  } = deps({
    observe: async () => 'failed',
    observed: async () => ({ action: null, failures: 1 }),
  })
  await runChecks(d)
  expect(posted).toEqual([])
  expect(lines).toContainEqual({
    event: 'watch_failed',
    target: 'top',
    failures: 1,
  })
  expect(JSON.stringify(lines)).not.toContain('slide.example')
})

test('F39-AC14: Given the state says "down" for one address, When a run is made, Then one message is posted for it', async () => {
  const {
    deps: d,
    posted,
    lines,
  } = deps({
    observed: async (name) => ({
      action: name === 'viewer' ? 'down' : null,
      failures: 2,
    }),
  })
  await runChecks(d)
  expect(posted).toHaveLength(1)
  expect(posted[0]).toContain('ページが開けません: viewer')
  expect(lines).toContainEqual({
    event: 'watch_notice_sent',
    target: 'viewer',
    action: 'down',
  })
})

test('F39-AC15: Given the state says "recovered", When a run is made, Then one message says it is open again', async () => {
  const { deps: d, posted } = deps({
    observed: async (name) => ({
      action: name === 'top' ? 'recovered' : null,
      failures: 0,
    }),
  })
  await runChecks(d)
  expect(posted).toHaveLength(1)
  expect(posted[0]).toContain('ページが開けるようになりました: トップ')
})

test('F39-AC14: Given a post that fails, When "down" was to be told, Then the state is told it is unsent, so it is tried again', async () => {
  const { deps: d, lines } = deps({
    observed: async (name) => ({
      action: name === 'top' ? 'down' : null,
      failures: 2,
    }),
    post: async () => false,
  })
  await runChecks(d)
  expect(d.unsent).toHaveBeenCalledWith('top')
  expect(lines).toContainEqual({
    event: 'watch_notice_not_sent',
    target: 'top',
    action: 'down',
  })
})

test('F39-AC10: Given no webhook, When "down" is to be told, Then nothing is posted, it is logged and tried again', async () => {
  const { deps: d, lines } = deps({
    webhook: null,
    observed: async (name) => ({
      action: name === 'top' ? 'down' : null,
      failures: 2,
    }),
  })
  await runChecks(d)
  expect(d.post).not.toHaveBeenCalled()
  expect(d.unsent).toHaveBeenCalledWith('top')
  expect(lines).toContainEqual({
    event: 'watch_notice_not_sent',
    target: 'top',
    action: 'down',
    reason: 'webhook_unset',
  })
})

test('D-120: Given maintenance, When a run is made, Then it is logged and nothing is posted', async () => {
  const {
    deps: d,
    lines,
    posted,
  } = deps({ observe: async () => 'maintenance' })
  await runChecks(d)
  expect(posted).toEqual([])
  expect(lines.filter((l) => l.event === 'watch_maintenance')).toHaveLength(3)
})

test('F39-AC14: Given the state cannot be reached for one address, When a run is made, Then that is logged by name and the others go on', async () => {
  const { deps: d, lines } = deps({
    observed: async (name) => {
      if (name === 'top') throw new TypeError('state')
      return { action: null, failures: 0 }
    },
  })
  await runChecks(d)
  expect(lines).toEqual([
    { event: 'watch_error', target: 'top', name: 'TypeError' },
  ])
  expect((d.observe as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3)
})

test('F39-AC12: Given addresses that are not set right, When a run is made, Then nothing is checked and it is logged', async () => {
  const { deps: d, lines } = deps({ targets: null })
  await runChecks(d)
  expect(d.observe).not.toHaveBeenCalled()
  expect(lines).toEqual([{ event: 'watch_targets_invalid' }])
})
