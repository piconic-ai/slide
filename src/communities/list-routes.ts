import { Hono } from 'hono'
import { renderPage } from '../decks/pages'
import { parsePeoplePage, PEOPLE_PER_PAGE } from '../follows/people'
import { NEW_COMMUNITIES_PATH } from '../site/home-shape'
import { langOf } from '../site/lang'
import { toCommunityCard } from './community-card'
import { newCommunitiesBody, newCommunitiesTitle } from './list-page'
import { countCommunities, listNewCommunities } from './list-store'

/** The list of every community, the newest made first. */
export const communityListRoutes = new Hono<{ Bindings: Env }>()

/**
 * Every community, 50 to a page (F30-AC47). Anyone may read it, signed in
 * or not, and every reader gets the same list.
 */
communityListRoutes.get(NEW_COMMUNITIES_PATH, async (c) => {
  const page = parsePeoplePage(c.req.query('page') ?? null)
  if (page === null) return c.notFound()
  const [shown, total] = await Promise.all([
    listNewCommunities(c.env.DB, {
      limit: PEOPLE_PER_PAGE,
      offset: (page - 1) * PEOPLE_PER_PAGE,
    }),
    countCommunities(c.env.DB),
  ])
  const lang = langOf(c)
  return renderPage(
    c,
    newCommunitiesTitle(lang),
    newCommunitiesBody(
      { cards: shown.map(toCommunityCard), page, total },
      lang,
    ),
  )
})
