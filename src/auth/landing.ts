import { parseSharePath, sharePath } from '../share/path'

/** Only canonical deck paths and the existing account destinations are allowed. */
export function landingOf(to: string | undefined): string {
  if (to === 'settings') return '/settings'
  const path = parseSharePath(to ?? '')
  if (path.kind === 'deck') return sharePath(path.handle, path.slug)
  if (path.kind === 'page') return sharePath(path.handle, path.slug, path.page)
  return '/slides'
}
