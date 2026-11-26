import type { TargetName, Targets, WatchSettings } from './watch-config'
import { TARGET_NAMES } from './watch-config'
import { maintenanceMessageOf, messageOf } from './watch-text'
import type { Sighting } from './observe'
import type { MaintenancePhase } from './watch-maintenance'
import type { MaintenanceVerdict, Verdict } from './watch-state'
import type { WebhookUrl } from './webhook-url'

/** What a run needs from outside: each is replaced by a fake in a test. */
export type RunDeps = Readonly<{
  targets: Targets | null
  settings: WatchSettings
  webhook: WebhookUrl | null
  now: number
  observe: (url: string) => Promise<Sighting>
  observed: (name: TargetName, seen: Sighting['seen']) => Promise<Verdict>
  /** Tells the maintenance state what this run saw; it answers what to tell. */
  sighted: (checks: readonly Sighting[]) => Promise<MaintenanceVerdict>
  maintenanceUnsent: (phase: MaintenancePhase) => Promise<void>
  unsent: (name: TargetName) => Promise<void>
  post: (text: string) => Promise<boolean>
  log: (line: Record<string, unknown>) => void
}>

async function checkOne(
  name: TargetName,
  deps: RunDeps,
): Promise<Sighting | null> {
  const { targets, webhook } = deps
  if (!targets) return null
  const sighting = await deps.observe(targets[name])
  const { seen } = sighting
  const { action, failures } = await deps.observed(name, seen)
  if (seen === 'failed')
    deps.log({ event: 'watch_failed', target: name, failures })
  if (seen === 'maintenance')
    deps.log({ event: 'watch_maintenance', target: name })
  if (action === null) return sighting
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
  return sighting
}

/**
 * Tells maintenance as it began, ran past its end, or ended (D-120): what the
 * run saw goes to the state, which says which one notice is owed, and it is
 * posted. A notice that did not get out is taken back, so the next run tells it.
 */
async function tellMaintenance(checks: readonly Sighting[], deps: RunDeps) {
  const { action } = await deps.sighted(checks)
  if (action === null) return
  const until = checks.reduce<number | null>(
    (latest, c) =>
      c.until === null ? latest : Math.max(latest ?? c.until, c.until),
    null,
  )
  const sent = deps.webhook
    ? await deps.post(maintenanceMessageOf(action, until))
    : false
  deps.log({
    event: sent ? 'watch_notice_sent' : 'watch_notice_not_sent',
    target: 'maintenance',
    action,
    ...(deps.webhook ? {} : { reason: 'webhook_unset' }),
  })
  if (!sent) await deps.maintenanceUnsent(action)
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
  const checks = await Promise.all(
    TARGET_NAMES.map((name) =>
      checkOne(name, deps).catch((error: unknown) => {
        deps.log({
          event: 'watch_error',
          target: name,
          name: error instanceof Error ? error.name : 'unknown',
        })
        return null
      }),
    ),
  )
  const seen = checks.filter((c): c is Sighting => c !== null)
  // With no address checked there is nothing to say of maintenance.
  if (seen.length === 0) return
  await tellMaintenance(seen, deps).catch((error: unknown) =>
    deps.log({
      event: 'watch_error',
      target: 'maintenance',
      name: error instanceof Error ? error.name : 'unknown',
    }),
  )
}
