import { z } from 'zod'

/** A violation report as browsers post it to a policy's report-uri. */
const reportSchema = z.object({
  'csp-report': z.object({ 'blocked-uri': z.string().min(1).max(4096) }),
})

const NETWORK_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:'])
/** A DNS name or IPv4 address as URL parsing spells it, or a bracketed IPv6. */
const HOST = /^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:.]+\])$/
export const MAX_HOST_LENGTH = 253

/**
 * The host a report says a slide tried to reach, or null when the report
 * names none: a malformed body, an inline or data resource, or the slide's
 * own host. Internationalized names stay in their ASCII spelling, so a name
 * cannot pass for another by its look.
 */
export function reportedHost(body: unknown, ownHost: string): string | null {
  const report = reportSchema.safeParse(body)
  if (!report.success) return null
  const blocked = report.data['csp-report']['blocked-uri']
  if (!URL.canParse(blocked)) return null
  const url = new URL(blocked)
  if (!NETWORK_SCHEMES.has(url.protocol)) return null
  const host = url.hostname.replace(/\.$/, '')
  if (host.length > MAX_HOST_LENGTH || !HOST.test(host)) return null
  return host === ownHost.toLowerCase() ? null : host
}
