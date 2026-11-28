import { Hono } from 'hono'
import { linkPagePath } from '../links/link-address'
import { findShownEventUrl } from '../links/link-page-store'

/** The number in /events/:id: digits only, as the service gave it. */
const eventIdOf = (value: string) =>
  /^[1-9][0-9]{0,15}$/u.test(value) ? Number(value) : null

/** Where the pages of events were, before the pages of links (F45). */
export const eventRoutes = new Hono<{ Bindings: Env }>()

/**
 * The page of an event is the page of links of its address: its number
 * leads there for good (F45-AC9). What is no number, a number of no event
 * and an event with no public talk are all not found, whoever asks.
 */
eventRoutes.get('/events/:id', async (c) => {
  const eventId = eventIdOf(c.req.param('id'))
  const url =
    eventId === null ? null : await findShownEventUrl(c.env.DB, eventId)
  return url === null ? c.notFound() : c.redirect(linkPagePath(url), 301)
})
