import { observeAddress } from './observe'
import { parseSettings, parseTargets, type TargetName } from './watch-config'
import { runChecks } from './watch-run'
import {
  WatchState,
  type MaintenanceVerdict,
  type Verdict,
} from './watch-state'
import { parseWebhookUrl } from './webhook-url'

export { WatchState }

/** The watcher's own bindings and settings. Nothing here is the service's. */
interface WatchEnv {
  STATE: DurableObjectNamespace
  /** Secret. The Discord webhook the notices go to. */
  DISCORD_WEBHOOK_URL?: string
  /** `{ "top": "https://…", "viewer": "https://…", "content": "https://…" }`. */
  WATCH_URLS?: unknown
  /** `{ failuresToTell, throttleSeconds, maintenanceChecksToFail, maintenanceOverrunSeconds, timeoutMs }`; all optional. */
  WATCH_SETTINGS?: unknown
}

const log = (line: Record<string, unknown>) => console.log(JSON.stringify(line))

async function post(webhook: string, text: string): Promise<boolean> {
  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: text.slice(0, 2000),
        username: 'slide watcher',
        allowed_mentions: { parse: [] },
        flags: 4,
      }),
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}

function checksOf(env: WatchEnv, now: number) {
  const settings = parseSettings(env.WATCH_SETTINGS)
  const webhook = parseWebhookUrl(env.DISCORD_WEBHOOK_URL)
  const state = env.STATE.get(env.STATE.idFromName('watch'))
  const call = (path: string, body: unknown) =>
    state.fetch(`https://watch.invalid${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  return runChecks({
    targets: parseTargets(env.WATCH_URLS),
    settings,
    webhook,
    now,
    observe: (url) => observeAddress(url, fetch, settings.timeoutMs),
    sighted: async (checks) => {
      const response = await call('/maintenance', {
        checks,
        now,
        overrunSeconds: settings.maintenanceOverrunSeconds,
      })
      if (!response.ok) throw new Error('state')
      return (await response.json()) as MaintenanceVerdict
    },
    maintenanceUnsent: async (phase) => {
      await call('/maintenance-unsent', { phase })
    },
    observed: async (name: TargetName, seen) => {
      const response = await call('/observe', {
        name,
        seen,
        now,
        rules: {
          failuresToTell: settings.failuresToTell,
          throttleSeconds: settings.throttleSeconds,
          maintenanceChecksToFail: settings.maintenanceChecksToFail,
        },
      })
      if (!response.ok) throw new Error('state')
      return (await response.json()) as Verdict
    },
    unsent: async (name) => {
      await call('/unsent', { name })
    },
    post: (text) => (webhook ? post(webhook, text) : Promise.resolve(false)),
    log,
  })
}

export default {
  scheduled(event, env, ctx) {
    ctx.waitUntil(checksOf(env, Math.floor(event.scheduledTime / 1000)))
  },
} satisfies ExportedHandler<WatchEnv>
