import { AUTHORIZE_PATH } from '../mcp/oauth-metadata'
import { returnToShare } from '../share/path'

/**
 * Where a sign-in lands. `top` is the top page, where a file picked before
 * signing in waits to be received. `agent` returns to the authorization
 * request an agent started, which waits in a cookie; see src/mcp.
 * `settings` is the settings, a share path that slide or profile, and
 * anything else the list of the author's slides.
 */
export function landingOf(to: string | undefined): string {
  if (to === 'top') return '/'
  if (to === 'agent') return AUTHORIZE_PATH
  return to === 'settings' ? '/settings' : returnToShare(to)
}
