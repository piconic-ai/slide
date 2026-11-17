import { z } from 'zod'

/** What a Cloudflare Access token must carry to be this application's. */
export type AccessConfig = Readonly<{
  /** The team domain, `https://<team>.cloudflareaccess.com`. */
  issuer: string
  /** The application's audience tag. */
  audience: string
}>

export type OperatorConfig = Readonly<{
  /** The only host that answers with the operator pages. */
  host: string
  origin: string
  /** Null leaves the host closed: every request is answered as missing. */
  access: AccessConfig | null
}>

export type OperatorSettings = Readonly<{
  origin: string | undefined
  teamDomain: string | undefined
  audience: string | undefined
  publicOrigin: string
  contentOrigin: string | undefined
}>

const audienceSchema = z.string().regex(/^[0-9a-f]{64}$/)

const isBareOrigin = (url: URL) =>
  url.pathname === '/' &&
  !url.search &&
  !url.hash &&
  !url.username &&
  !url.password

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function parseIssuer(value: string | undefined): string | null {
  const url = value ? parseUrl(value) : null
  if (!url || url.protocol !== 'https:' || !isBareOrigin(url) || url.port)
    return null
  return /^[a-z0-9-]+\.cloudflareaccess\.com$/.test(url.hostname)
    ? url.origin
    : null
}

function parseAccess(settings: OperatorSettings): AccessConfig | null {
  const issuer = parseIssuer(settings.teamDomain)
  const audience = audienceSchema.safeParse(settings.audience)
  return issuer && audience.success ? { issuer, audience: audience.data } : null
}

function isSeparateHost(url: URL, settings: OperatorSettings): boolean {
  if (url.hostname === new URL(settings.publicOrigin).hostname) return false
  const content = settings.contentOrigin
    ? parseUrl(settings.contentOrigin)
    : null
  return (
    !content ||
    (url.hostname !== content.hostname &&
      !url.hostname.endsWith(`.${content.hostname}`))
  )
}

/**
 * The operator host and its Access settings, or null when no operator host
 * is configured. A host with missing or malformed Access settings is still
 * returned, closed, so that it never falls through to another app.
 */
export function parseOperatorConfig(
  settings: OperatorSettings,
): OperatorConfig | null {
  const url = settings.origin ? parseUrl(settings.origin) : null
  if (!url || !isBareOrigin(url)) return null
  const local = url.hostname.endsWith('localhost')
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    return null
  if (!isSeparateHost(url, settings)) return null
  return {
    host: url.hostname,
    origin: url.origin,
    access: parseAccess(settings),
  }
}

/** Whether a request URL addresses the operator host. */
export function isOperatorHost(config: OperatorConfig | null, url: URL) {
  return config !== null && url.hostname.replace(/\.+$/, '') === config.host
}
