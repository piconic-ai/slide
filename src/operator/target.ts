import type { DeckSlug } from '../decks/binding'
import type { Handle } from '../share/handle'
import { parseSharePath } from '../share/path'

export type TakedownTarget = Readonly<{ handle: Handle; slug: DeckSlug }>

/**
 * The deck an operator names, as a share URL of this service or as its
 * path, such as `@kfly8/good-slide`. A URL of another origin names nothing
 * here, and neither does a profile.
 */
export function parseTakedownTarget(
  input: string,
  publicOrigin: string,
): TakedownTarget | null {
  const text = input.trim()
  let pathname: string
  if (/^https?:\/\//i.test(text)) {
    let url: URL
    try {
      url = new URL(text)
    } catch {
      return null
    }
    if (url.origin !== new URL(publicOrigin).origin) return null
    pathname = url.pathname
  } else {
    pathname = text.startsWith('/') ? text : `/${text}`
  }
  let path = parseSharePath(pathname)
  if (path.kind === 'redirect') path = parseSharePath(path.path)
  return path.kind === 'deck' || path.kind === 'page'
    ? { handle: path.handle, slug: path.slug }
    : null
}
