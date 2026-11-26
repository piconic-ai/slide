import { AUTHORIZE_PATH } from '../mcp/oauth-metadata'
import { stashLanding } from '../drops/stash'
import {
  COMMUNITY_MANAGE_PATH,
  newCommunityLanding,
} from '../communities/new-landing'
import { returnToShare } from '../share/path'

/**
 * Where a sign-in lands. `top` is the top page, where a file picked before
 * signing in waits to be received; `drop` is the token of the press that
 * began this sign-in, given back so the page knows its own return. `agent` returns to the authorization
 * request an agent started, which waits in a cookie; see src/mcp.
 * `settings` is the settings, `/communities/new` (with the group's page it
 * carries) the page that makes a community, `/my/communities` the
 * communities the person runs, a share path that slide or
 * profile, and anything else the list of the author's slides.
 */
export function landingOf(to: string | undefined, drop?: string): string {
  if (to === 'top') return stashLanding(drop)
  if (to === 'agent') return AUTHORIZE_PATH
  const community = newCommunityLanding(to)
  if (community !== null) return community
  if (to === COMMUNITY_MANAGE_PATH) return COMMUNITY_MANAGE_PATH
  return to === 'settings' ? '/settings' : returnToShare(to)
}
