import type { TargetName, Targets, WatchSettings } from './watch-config'
import { TARGET_NAMES } from './watch-config'
import { messageOf } from './watch-text'
import type { Observation } from './watch-step'
import type { Verdict } from './watch-state'
import type { WebhookUrl } from './webhook-url'

/** What a run needs from outside: each is replaced by a fake in a test. */
export type RunDeps = Readonly<{
  targets: Targets | null
  settings: WatchSettings
  webhook: WebhookUrl | null
  now: number
  observe: (url: string) => Promise<Observation>
  observed: (name: TargetName, seen: Observation) => Promise<Verdict>
  unsent: (name: TargetName) => Promise<void>
  post: (text: string) => Promise<boolean>
  log: (line: Record<string, unknown>) => void
}>

async function checkOne(name: TargetName, deps: RunDeps) {
  const { targets, webhook } = deps
  if (!targets) return
  const seen = await deps.observe(targets[name])
  const { action, failures } = await deps.observed(name, seen)
  if (seen === 'failed')
    deps.log({ event: 'watch_failed', target: name, failures })
  if (seen === 'maintenance')
    deps.log({ event: 'watch_maintenance', target: name })
  if (action === null) return
  const sent = webhook
    ? await deps.post(messageOf(action, name, failures))
    : false
  deps.log({
    event: sent ? 'watch_notice_sent' : 'watch_notice_not_sent',
    target: name,
    action,
    ...(webhook ? {} : { reason: 'webhook_unset' }),
  })
  // A notice that did not get out is tried again at the next failed check.
  if (!sent && action === 'down') await deps.unsent(name)
}

/**
 * One firing of the watcher (D-57): every address is checked, and the state
 * and the notice follow. An address that cannot be checked or recorded is
 * logged by its name, and the others go on.
 */
export async function runChecks(deps: RunDeps): Promise<void> {
  if (!deps.targets) {
    deps.log({ event: 'watch_targets_invalid' })
    return
  }
  await Promise.all(
    TARGET_NAMES.map((name) =>
      checkOne(name, deps).catch((error: unknown) =>
        deps.log({
          event: 'watch_error',
          target: name,
          name: error instanceof Error ? error.name : 'unknown',
        }),
      ),
    ),
  )
}
