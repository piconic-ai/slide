import { z } from 'zod'

const deploymentIdSchema = z.uuid()

/**
 * The configured content origin, such as `https://slideusercontent.example`.
 * Each deployment gets its own origin as a subdomain of it. Null disables
 * owner preview and content delivery.
 */
export function parseContentBase(value: string | undefined): URL | null {
  if (!value) return null
  const url = new URL(value)
  const local = url.hostname === 'localhost'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw new Error('CONTENT_ORIGIN must use https')
  if (url.pathname !== '/' || url.search || url.hash || url.username)
    throw new Error('CONTENT_ORIGIN must be a bare origin')
  return url
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
