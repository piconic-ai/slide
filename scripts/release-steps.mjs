// The steps of a release, in order: note where the database is, apply the
// migrations, deploy, check. It stops at the first step that fails, tells
// Discord, and never goes on to a later step. Every outside effect is handed
// in (`run` for wrangler, `check` for the post-deploy checks, `tell` for the
// notice, `log`), so a test runs the whole order without a command or a
// network. docs/dev/release-flow.md (REL-AC6, REL-AC7) says what is promised.
import { checkLines, failedChecks } from './post-deploy-checks.mjs'

/** The steps, in the order they run. */
export const STEPS = ['record', 'migrate', 'deploy', 'verify']

const STEP_TEXT = {
  record: 'Time Travel の位置の記録',
  migrate: 'migration の適用',
  deploy: 'Worker の deploy',
  verify: '反映の後の確認',
}

/** The Time Travel bookmark in `wrangler d1 time-travel info --json`, or null. */
export function parseBookmark(stdout) {
  try {
    const { bookmark } = JSON.parse(stdout)
    return typeof bookmark === 'string' && bookmark !== '' ? bookmark : null
  } catch {
    return null
  }
}

/** The 7 characters of a commit that name a build in a message, or "unknown". */
export const shortCommit = (sha) =>
  typeof sha === 'string' && /^[0-9a-f]{7,40}$/.test(sha)
    ? sha.slice(0, 7)
    : 'unknown'

/** The notice for a release that stopped before the checks. Fixed words only. */
export const stoppedNotice = (step, sha) =>
  [
    '[slide] 反映が途中で止まりました',
    `止まった段階: ${STEP_TEXT[step]}`,
    `版: ${shortCommit(sha)}`,
    '手順: docs/dev/deploy.md#反映が止まったとき',
  ].join('\n')

/** The notice for checks that failed after the deploy (kind deploy_check_failed). */
export const checkFailedNotice = (names, sha) =>
  [
    '[slide] 反映の後の確認に失敗しました',
    `件数: ${names.length} 回`,
    `版: ${shortCommit(sha)}`,
    `確認: ${names.join(', ')}`,
    '手順: docs/dev/alerts-runbook.md#deploy-check-failed',
  ].join('\n')

/**
 * Runs the release. `run(args)` runs `wrangler <args>` and resolves to
 * `{ code, stdout }`; `check()` resolves to the post-deploy results.
 * Resolves to `{ ok, step }`: `step` is the one that failed, or null.
 */
export async function runRelease({ run, check, tell, log, database, commit }) {
  const stop = async (step) => {
    log(`stopped at: ${step}`)
    await tell(stoppedNotice(step, commit))
    return { ok: false, step }
  }

  log('step 1/4: note the Time Travel position')
  const info = await run(['d1', 'time-travel', 'info', database, '--json'])
  const bookmark = info.code === 0 ? parseBookmark(info.stdout) : null
  if (!bookmark) return stop('record')
  log(`Time Travel bookmark before this release: ${bookmark}`)

  log('step 2/4: apply the migrations')
  const migrated = await run([
    'd1',
    'migrations',
    'apply',
    database,
    '--remote',
  ])
  if (migrated.code !== 0) return stop('migrate')

  log('step 3/4: deploy')
  const deployed = await run(['deploy'])
  if (deployed.code !== 0) return stop('deploy')

  log('step 4/4: check the release')
  const results = await check()
  for (const line of checkLines(results)) log(line)
  const failed = failedChecks(results)
  if (failed.length > 0) {
    log(`stopped at: verify (${failed.length} failed)`)
    await tell(checkFailedNotice(failed, commit))
    return { ok: false, step: 'verify' }
  }
  log('the release is checked')
  return { ok: true, step: null }
}
