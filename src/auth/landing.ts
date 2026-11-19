import { AUTHORIZE_PATH } from '../mcp/oauth-metadata'
import { returnToShare } from '../share/path'

/**
 * Where a sign-in lands. `agent` returns to the authorization request an
 * agent started, which waits in a cookie; see src/mcp.
 */
export function landingOf(to: string | undefined): string {
  if (to === 'agent') return AUTHORIZE_PATH
  return to === 'settings' ? '/settings' : returnToShare(to)
}
