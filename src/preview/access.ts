import { renewedExpiry } from './lifetime'

/**
 * The stored file path a request path names, or null when it cannot name
 * one. Directory paths serve their index.html; nothing else is guessed.
 */
export function requestedFile(pathname: string): string | null {
  let path: string
  try {
    path = decodeURIComponent(pathname.slice(1))
  } catch {
    return null
  }
  if (path === '' || path.endsWith('/')) path += 'index.html'
  const segments = path.split('/')
  if (
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..',
    )
  )
    return null
  // Reserved for the service's own routes on content origins.
  if (segments[0] === '_preview') return null
  return path.normalize('NFC')
}

export type AccessFacts = Readonly<{
  /** The deployment is the deck's public deployment and is ready. */
  isPublic: boolean
  /** The owner's live viewing session for this deployment, if any. */
  session: Readonly<{ expiresAt: number; hardExpiresAt: number }> | null
  /** The request carried a viewing session cookie at all. */
  presentedSession: boolean
}>

export type Access =
  | Readonly<{ kind: 'public' }>
  | Readonly<{ kind: 'owner'; renewTo: number | null }>
  /** The session ended; the owner can open the deployment again. */
  | Readonly<{ kind: 'reopen' }>
  /** Nothing to show; drafts look the same as missing deployments. */
  | Readonly<{ kind: 'not_found' }>

/** Decides whether a request may read a deployment's files. */
export function decideAccess(facts: AccessFacts, now: number): Access {
  if (facts.isPublic) return { kind: 'public' }
  const { session } = facts
  if (session && now < session.expiresAt && now < session.hardExpiresAt)
    return { kind: 'owner', renewTo: renewedExpiry(session, now) }
  return facts.presentedSession ? { kind: 'reopen' } : { kind: 'not_found' }
}
