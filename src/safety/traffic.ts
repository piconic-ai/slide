import { z } from 'zod'

/** What a slide did with another host, as a content policy names it. */
export const KINDS = [
  'script',
  'style',
  'image',
  'font',
  'data',
  'frame',
  'media',
  'other',
] as const
export type Kind = (typeof KINDS)[number]

/** The page is not known: the report came without one. */
export const PAGE_UNKNOWN = -1
/** While the slides opened, whichever page the reader started on. */
export const PAGE_OPENING = 0
export const MAX_PAGE = 9999
export const MAX_HOST_LENGTH = 253
export const MAX_PATH_LENGTH = 200

/** One exchange between a slide and another host. */
export type Traffic = Readonly<{
  kind: Kind
  host: string
  /** The URL's path, cut to a bounded length. The query is never kept. */
  path: string
  page: number
}>

/** A violation report as browsers post it to a policy's report-uri. */
const reportSchema = z.object({
  'csp-report': z.object({
    'blocked-uri': z.string().min(1).max(4096),
    'effective-directive': z.string().max(100).optional(),
    'violated-directive': z.string().max(4096).optional(),
  }),
})

const NETWORK_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:'])
/** A DNS name or IPv4 address as URL parsing spells it, or a bracketed IPv6. */
const HOST = /^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:.]+\])$/

const KIND_OF_DIRECTIVE: ReadonlyMap<string, Kind> = new Map([
  ['script-src', 'script'],
  ['script-src-elem', 'script'],
  ['style-src', 'style'],
  ['style-src-elem', 'style'],
  ['img-src', 'image'],
  ['font-src', 'font'],
  ['connect-src', 'data'],
  ['frame-src', 'frame'],
  ['child-src', 'frame'],
  ['media-src', 'media'],
])

/**
 * The kind a directive stands for; one this does not know is `other`. A
 * violated directive comes with its sources, which are left out.
 */
export const kindOf = (directive: string | undefined): Kind =>
  KIND_OF_DIRECTIVE.get(directive?.trim().split(/\s+/)[0] ?? '') ?? 'other'

/**
 * The host and path a URL names, or null when it names no other host: not a
 * network URL, a malformed host, or one of `ownHosts`. Internationalized
 * names stay in their ASCII spelling, so a name cannot pass for another by
 * its look. The query, fragment, port and credentials are dropped.
 */
export function placeOf(
  value: string,
  ownHosts: readonly string[],
): Pick<Traffic, 'host' | 'path'> | null {
  if (!URL.canParse(value)) return null
  const url = new URL(value)
  if (!NETWORK_SCHEMES.has(url.protocol)) return null
  const host = url.hostname.replace(/\.$/, '')
  if (host.length > MAX_HOST_LENGTH || !HOST.test(host)) return null
  if (ownHosts.some((own) => own.toLowerCase() === host)) return null
  return { host, path: url.pathname.slice(0, MAX_PATH_LENGTH) || '/' }
}

/**
 * What a report says a slide exchanged with another host, or null when the
 * report names none: a malformed body, an inline or data resource, or one
 * of `ownHosts`. A report posted by the browser carries no page.
 */
export function reportedTraffic(
  body: unknown,
  ownHosts: readonly string[],
): Traffic | null {
  const report = reportSchema.safeParse(body)
  if (!report.success) return null
  const fields = report.data['csp-report']
  const place = placeOf(fields['blocked-uri'], ownHosts)
  if (!place) return null
  const directive =
    fields['effective-directive'] ?? fields['violated-directive']
  return { ...place, kind: kindOf(directive), page: PAGE_UNKNOWN }
}
