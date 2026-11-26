import { Hono } from 'hono'
import { currentOwner } from '../auth/owner-middleware'
import { accountTitles, renderPage, signInPrompt } from '../decks/pages'
import { langOf } from '../site/lang'
import { listManagedCommunities } from './admin-store'
import { communityManageBody, communityManageTitle } from './manage-page'
import { COMMUNITY_MANAGE_PATH } from './new-landing'

/** The page listing the communities a person runs. */
export const communityManageRoutes = new Hono<{ Bindings: Env }>()

/**
 * The communities the signed-in person runs (F30-AC60, F30-AC61). Like the
 * list of their slides, someone not signed in is asked to sign in, coming
 * back here (F30-AC62), and a suspended person is refused by currentOwner.
 */
communityManageRoutes.get(COMMUNITY_MANAGE_PATH, async (c) => {
  const owner = await currentOwner(c)
  const lang = langOf(c)
  if (!owner)
    return renderPage(
      c,
      accountTitles(lang).signInTitle,
      signInPrompt(lang, COMMUNITY_MANAGE_PATH),
      401,
    )
  const managed = await listManagedCommunities(c.env.DB, owner.userId)
  return renderPage(
    c,
    communityManageTitle(lang),
    communityManageBody(managed, lang),
  )
})
