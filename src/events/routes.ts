import { Hono } from 'hono'
import { homePagePolicy, renderPage } from '../decks/pages'
import { contentBaseOf } from '../preview/config'
import { alternateLinks } from '../site/i18n'
import { langOf } from '../site/lang'
import { defaultEventCover, eventPageBody, eventPageTitle } from './event-page'
import { readEventPage } from './store'

/** The number in /events/:id: digits only, as the service gave it. */
const eventIdOf = (value: string) =>
  /^[1-9][0-9]{0,15}$/u.test(value) ? Number(value) : null

/** The pages of events, open to everyone. */
export const eventRoutes = new Hono<{ Bindings: Env }>()

/**
 * The page of one event. An unknown number and an event with no public talk
 * are both not found. Nothing is fetched from the event's site.
 */
eventRoutes.get('/events/:id', async (c) => {
  const eventId = eventIdOf(c.req.param('id'))
  const read = eventId === null ? null : await readEventPage(c.env.DB, eventId)
  if (!read) return c.notFound()
  const lang = langOf(c)
  const contentBase = contentBaseOf(c.env)
  const url = new URL(c.req.url)
  c.header('Link', alternateLinks(c.env.PUBLIC_ORIGIN, url))
  return renderPage(
    c,
    eventPageTitle(read.event, lang),
    eventPageBody(
      {
        ...read,
        // Communities are another piece of work; until then none has one.
        community: null,
        cover: defaultEventCover(read.event.id),
        contentBase,
      },
      lang,
    ),
    200,
    homePagePolicy(contentBase),
  )
})
