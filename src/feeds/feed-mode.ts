/**
 * Where the reader's requests go (F33-AC15): to Luma only from the service
 * itself, to the local feed only on a local start that asks for it, and
 * nowhere otherwise, so no test or local start ever reaches Luma.
 */

/** The origin of the service; only it reads Luma's feeds. */
export const SERVICE_ORIGIN = 'https://slide.community'

/** Hosts a local start runs on. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1'])

export type FeedMode = 'luma' | 'mock' | 'off'

/**
 * The mode of the settings: `mock` when LUMA_FEED_MOCK is "on" and the
 * service runs on a local host, `luma` on the service's own origin without
 * it, `off` anywhere else.
 */
export function feedModeOf(
  settings: Readonly<{ mock: string | undefined; publicOrigin: string }>,
): FeedMode {
  let host: string
  try {
    host = new URL(settings.publicOrigin).hostname
  } catch {
    return 'off'
  }
  if (settings.mock !== undefined && settings.mock !== '')
    return settings.mock === 'on' && LOCAL_HOSTS.has(host) ? 'mock' : 'off'
  return settings.publicOrigin === SERVICE_ORIGIN ? 'luma' : 'off'
}
