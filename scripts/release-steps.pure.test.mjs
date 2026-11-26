import { expect, test } from 'vitest'
import { holdsNoPersonalData } from './discord-notice.mjs'
import {
  checkFailedNotice,
  parseBookmark,
  runRelease,
  shortCommit,
  stoppedNotice,
} from './release-steps.mjs'

const SHA = '0123456789abcdef0123456789abcdef01234567'
const ok = { state: 'ok', name: 'top page', detail: 'status 200' }
const bad = { state: 'failed', name: 'help', detail: 'status 503' }

/**
 * A release with every outside effect recorded in one list, so a test reads
 * the order of the whole run. `fails` names a step whose command fails.
 */
function release({ fails = [], results = [ok], bookmark = 'bk-1' } = {}) {
  const calls = []
  const run = async (args) => {
    calls.push(`wrangler ${args.join(' ')}`)
    const step = args[0] === 'd1' ? args[1] : args[0]
    if (fails.includes(step)) return { code: 1, stdout: '' }
    return {
      code: 0,
      stdout: step === 'time-travel' ? JSON.stringify({ bookmark }) : '',
    }
  }
  const check = async () => {
    calls.push('check')
    return results
  }
  const tell = async (text) => calls.push(`tell ${text.split('\n')[0]}`)
  const logs = []
  const done = runRelease({
    run,
    check,
    tell,
    log: (line) => logs.push(line),
    database: 'slide',
    commit: SHA,
  })
  return done.then((outcome) => ({ outcome, calls, logs }))
}

test('REL-AC6: Given every step succeeds, When the release runs, Then it records, migrates, deploys and checks, in that order, and tells no one', async () => {
  const { outcome, calls } = await release()
  expect(outcome).toEqual({ ok: true, step: null })
  expect(calls).toEqual([
    'wrangler d1 time-travel info slide --json',
    'wrangler d1 migrations apply slide --remote',
    'wrangler deploy',
    'check',
  ])
})

test('REL-AC6: Given the Time Travel position is noted, When the release runs, Then the bookmark is in the log before the migrations are applied', async () => {
  const { logs } = await release({ bookmark: 'bk-42' })
  const noted = logs.findIndex((line) => line.includes('bk-42'))
  const migrating = logs.findIndex((line) =>
    line.includes('apply the migrations'),
  )
  expect(noted).toBeGreaterThan(-1)
  expect(noted).toBeLessThan(migrating)
})

test.each([
  ['time-travel', 'record', ['wrangler d1 time-travel info slide --json']],
  [
    'migrations',
    'migrate',
    [
      'wrangler d1 time-travel info slide --json',
      'wrangler d1 migrations apply slide --remote',
    ],
  ],
  [
    'deploy',
    'deploy',
    [
      'wrangler d1 time-travel info slide --json',
      'wrangler d1 migrations apply slide --remote',
      'wrangler deploy',
    ],
  ],
])(
  'REL-AC6: Given the %s command fails, When the release runs, Then it stops there, runs no later step, and tells Discord once',
  async (failing, step, ran) => {
    const { outcome, calls } = await release({ fails: [failing] })
    expect(outcome).toEqual({ ok: false, step })
    expect(calls).toEqual([...ran, 'tell [slide] 反映が途中で止まりました'])
    expect(calls).not.toContain('check')
  },
)

test('REL-AC6: Given the Time Travel answer holds no bookmark, When the release runs, Then it stops before touching the database', async () => {
  for (const bookmark of ['', null, 7]) {
    const { outcome, calls } = await release({ bookmark })
    expect(outcome).toEqual({ ok: false, step: 'record' })
    expect(calls.some((call) => call.includes('migrations'))).toBe(false)
    expect(calls.some((call) => call === 'wrangler deploy')).toBe(false)
  }
})

test('REL-AC8: Given a check fails after the deploy, When the release runs, Then it fails at verify, names the failed item and tells Discord once', async () => {
  const { outcome, calls, logs } = await release({ results: [ok, bad] })
  expect(outcome).toEqual({ ok: false, step: 'verify' })
  expect(calls.at(-1)).toBe('tell [slide] 反映の後の確認に失敗しました')
  expect(calls.filter((call) => call.startsWith('tell'))).toHaveLength(1)
  expect(logs.join('\n')).toContain('failed  help: status 503')
})

test('REL-AC8: Given a check only skipped, When the release runs, Then the release passes', async () => {
  const skipped = {
    state: 'skipped',
    name: 'public slide viewer',
    detail: 'no public slide',
  }
  const { outcome } = await release({ results: [ok, skipped] })
  expect(outcome.ok).toBe(true)
})

test('REL-AC7: Given a notice, When it is built, Then it names the step, the commit and the way to look, and holds no personal data', () => {
  const stopped = stoppedNotice('migrate', SHA)
  expect(stopped).toContain('migration の適用')
  expect(stopped).toContain('0123456')
  expect(stopped).not.toContain(SHA)
  expect(holdsNoPersonalData(stopped)).toBe(true)
  const failed = checkFailedNotice(['help', 'login'], SHA)
  expect(failed).toContain('件数: 2 回')
  expect(failed).toContain('確認: help, login')
  expect(holdsNoPersonalData(failed)).toBe(true)
})

test.each([undefined, '', 'not-a-sha', 'ABCDEF1', '0123456; rm -rf /', 42])(
  'REL-AC7: Given the commit is %j, When it is named in a notice, Then it reads "unknown" and nothing of it is copied',
  (sha) => {
    expect(shortCommit(sha)).toBe('unknown')
    expect(stoppedNotice('deploy', sha)).toContain('版: unknown')
  },
)

test.each([
  ['{"bookmark":"00000001-00000002-0000"}', '00000001-00000002-0000'],
  ['{"bookmark":""}', null],
  ['{}', null],
  ['not json', null],
  ['', null],
  ['{"bookmark":5}', null],
])(
  'REL-AC6: Given the Time Travel answer %j, When the bookmark is read, Then it is %j',
  (text, expected) => {
    expect(parseBookmark(text)).toBe(expected)
  },
)
