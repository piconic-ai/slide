import { returnToShare } from '../share/path'

/**
 * Where a sign-in ends. `top` is the top page, where a file picked before
 * signing in waits to be received; `settings` the settings; a share path
 * that slide or profile; anything else the list of the author's slides.
 */
export function landingOf(to: string | undefined): string {
  if (to === 'top') return '/'
  return to === 'settings' ? '/settings' : returnToShare(to)
}
