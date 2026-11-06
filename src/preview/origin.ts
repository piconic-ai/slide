import { z } from 'zod'

const deploymentIdSchema = z.uuid()

/**
 * The configured content origin, such as `https://slideusercontent.example`.
 * Each deployment gets its own origin as a subdomain of it. Null disables
 * owner preview and content delivery.
 */
export function parseContentBase(
  value: string | undefined,
  publicOrigin: string,
): URL | null {
  if (!value) return null
  const url = new URL(value)
  const local = url.hostname === 'localhost'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw new Error('CONTENT_ORIGIN must use https')
  if (
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error('CONTENT_ORIGIN must be a bare origin')
  // Author origins must not be same-site with the management origin. Local
  // development shares localhost, where only d-* subdomains are content.
  const management = new URL(publicOrigin).hostname
  const content = url.hostname
  if (
    (content === management && !local) ||
    content.endsWith(`.${management}`) ||
    management.endsWith(`.${content}`)
  )
    throw new Error(
      'CONTENT_ORIGIN must be a different site from PUBLIC_ORIGIN',
    )
  return url
}

export type HostRoute =
  | Readonly<{ kind: 'management' }>
  | Readonly<{ kind: 'deployment'; deploymentId: string }>
  /** Under the content domain but not a deployment origin. */
  | Readonly<{ kind: 'content_other' }>

/**
 * Decides which app answers a request. Nothing on the content domain or its
 * subdomains reaches the management app, whatever its spelling.
 */
export function routeOfHost(
  base: URL | null,
  publicOrigin: string,
  url: URL,
): HostRoute {
  const host = url.hostname.replace(/\.+$/, '')
  if (!base || host === new URL(publicOrigin).hostname)
    return { kind: 'management' }
  if (host !== base.hostname && !host.endsWith(`.${base.hostname}`))
    return { kind: 'management' }
  const deploymentId = deploymentOfUrl(base, url)
  return deploymentId
    ? { kind: 'deployment', deploymentId }
    : { kind: 'content_other' }
}

/** The origin that serves one deployment's files. */
export function deploymentOrigin(base: URL, deploymentId: string): string {
  const id = deploymentIdSchema.parse(deploymentId)
  return `${base.protocol}//d-${id}.${base.host}`
}

/**
 * The deployment a request URL addresses, or null when it is not a content
 * origin under `base`. Scheme and port must match the configuration.
 */
export function deploymentOfUrl(base: URL, url: URL): string | null {
  if (url.protocol !== base.protocol || url.port !== base.port) return null
  const suffix = `.${base.hostname}`
  if (!url.hostname.endsWith(suffix)) return null
  const label = url.hostname.slice(0, -suffix.length)
  const match = /^d-(.+)$/.exec(label)
  const id = match?.[1]
  return id && deploymentIdSchema.safeParse(id).success ? id : null
}
