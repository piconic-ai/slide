import type { Handle } from '../share/handle'
import { parseSharePath } from '../share/path'

/** An account named by a handle or a profile URL of this service. */
export function parseSuspensionTarget(
  input: string,
  publicOrigin: string,
): Handle | null {
  const text = input.trim()
  const pathname = profilePathname(text, publicOrigin)
  if (pathname === null) return null
  let path = parseSharePath(pathname)
  if (path.kind === 'redirect') path = parseSharePath(path.path)
  return path.kind === 'profile' ? path.handle : null
}

function profilePathname(text: string, publicOrigin: string): string | null {
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text)
      return url.origin === new URL(publicOrigin).origin ? url.pathname : null
    } catch {
      return null
    }
  }
  if (text.startsWith('/')) return text
  return text.startsWith('@') ? `/${text}` : `/@${text}`
}
