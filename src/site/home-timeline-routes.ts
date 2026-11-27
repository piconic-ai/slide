import { Hono } from 'hono'
import { currentOwner } from '../auth/owner-middleware'
import { readCitedCounts } from '../citations/pair-store'
import { readAuthorFaces } from '../profile/author-faces-store'
import { listNewCommunities } from '../communities/list-store'
import { contentBaseOf } from '../preview/config'
import {
  toDiscoverCommunity,
  toDiscoverPerson,
  toFollowingDecks,
  type HomeDiscover,
} from './home-discover'
import { parseDeckPage } from './home-more-query'
import { HOME_CAROUSEL_SHOWN, HOME_TIMELINE_FIRST } from './home-timeline'
import { listFollowingSlides, listNewPeople } from './home-timeline-store'

/** The two answers the top page's timeline asks for besides the recent slides. */
export const homeTimelineRoutes = new Hono<{ Bindings: Env }>()

/**
 * The "following" tab (F44-AC5): the slides of the people and the
 * communities the signed-in visitor follows, as one list. The answer is one
 * person's, and no cache keeps it; a request without a session is answered
 * with nothing (F44-AC8).
 */
homeTimelineRoutes.get('/api/home/following-slides', async (c) => {
  c.header('Cache-Control', 'private, no-store')
  c.header('Vary', 'Cookie', { append: true })
  const page = parseDeckPage(c.req.query(), HOME_TIMELINE_FIRST)
  if (!page) return c.json({ error: 'bad page' }, 400)
  const owner = await currentOwner(c)
  if (!owner) return c.json(null)
  const slides = await listFollowingSlides(c.env.DB, {
    viewer: owner.userId,
    limit: page.limit,
    after: page.after,
  })
  const citedBy = await readCitedCounts(
    c.env.DB,
    slides.map((slide) => slide.handle),
    owner.userId,
  )
  const faces = await readAuthorFaces(
    c.env.DB,
    slides.map((slide) => slide.handle),
  )
  return c.json(toFollowingDecks(slides, contentBaseOf(c.env), citedBy, faces))
})

/**
 * What the "all" timeline's carousels show (F44-AC17, F44-AC18): the people
 * who registered most recently and the communities made most recently, less
 * those the visitor follows (and, for people, the visitor and who they muted
 * or blocked). The same for every visitor who is not signed in, so a shared
 * cache may keep it for a minute.
 */
homeTimelineRoutes.get('/api/home/discover', async (c) => {
  const owner = await currentOwner(c)
  const viewer = owner?.userId ?? null
  c.header(
    'Cache-Control',
    viewer === null ? 'public, max-age=60' : 'private, no-store',
  )
  c.header('Vary', 'Cookie', { append: true })
  const [people, communities] = await Promise.all([
    listNewPeople(c.env.DB, { viewer, limit: HOME_CAROUSEL_SHOWN }),
    listNewCommunities(c.env.DB, {
      limit: HOME_CAROUSEL_SHOWN,
      offset: 0,
      notFollowedBy: viewer,
    }),
  ])
  const answer: HomeDiscover = {
    signedIn: viewer !== null,
    people: people.map(toDiscoverPerson),
    communities: communities.map(toDiscoverCommunity),
  }
  return c.json(answer)
})
