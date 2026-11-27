import { Hono, type Context } from 'hono'
import { currentOwner } from '../auth/owner-middleware'
import { communityCoverOf, communityHref } from '../communities/community'
import { listEventCommunities } from '../communities/event-communities-store'
import { homePagePolicy, PAGE_POLICY } from '../decks/pages'
import {
  defaultEventCover,
  eventPageBody,
  eventPageTitle,
} from '../events/event-page'
import { readEventPage } from '../events/store'
import { recordFrom } from '../metrics/record-routes'
import { contentBaseOf } from '../preview/config'
import { ERROR_PAGE_POLICY, errorPage } from '../site/error-pages'
import { langOf } from '../site/lang'
import { pageShell } from '../site/shell'
import {
  eventKeysOf,
  linkPagePath,
  linkTargetOf,
  parseLinkPath,
  type LinkTarget,
} from './link-address'
import {
  linkMissingBody,
  linkMissingStyle,
  linkMissingTitle,
} from './link-missing-page'
import { findAliasedKey, findEventIdsByKey } from './link-page-store'

type C = Context<{ Bindings: Env }>

const PREFIX = '/link/'

/**
 * What the footer's language switch reopens. Under `/link/` the query is
 * the link's own, `lang` included (F45-AC33), so the switch goes through
 * `/link?to=<path>&lang=…`, which keeps the choice and comes back
 * (F45-AC34). Without a page to come back to, it is `/link` alone.
 */
const switchUrlOf = (c: C, rest: string | null) =>
  new URL(
    rest === null ? '/link' : `/link?to=${encodeURIComponent(PREFIX + rest)}`,
    c.req.url,
  )

/** A 404 counts as an error page shown by this route (F40-AC14). */
const countNotFound = (c: C) =>
  recordFrom(c, {
    name: 'screen_error',
    kind: 'not_found',
    screen: c.req.routePath,
  })

/**
 * The answer to what cannot be read as an https address (F45-AC13): the
 * common 404. What was written is in no text and no href of it, the footer
 * included.
 */
function refused(c: C) {
  countNotFound(c)
  return c.html(errorPage('not_found', langOf(c), switchUrlOf(c, null)), 404, {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': ERROR_PAGE_POLICY,
  })
}

/** What follows `/link/` as it was sent: `c.req.path` would decode it. */
function sentRestOf(c: C): string {
  const url = new URL(c.req.url)
  return url.pathname.slice(PREFIX.length) + url.search
}

/**
 * Where the page is when not at the path asked: the one way of writing the
 * address (F45-AC31), or, for a Luma id a calendar's feed paired with a
 * name, the page of the name (F45-AC26). Null when it is here.
 */
async function movedTo(
  database: D1Database,
  sent: string,
  target: LinkTarget,
): Promise<string | null> {
  if (sent !== target.rest) return PREFIX + target.rest
  if (!target.eventShaped || target.eventKey === null) return null
  const named = await findAliasedKey(database, target.eventKey)
  return named === null ? null : linkPagePath(named)
}

type Shown = Readonly<{
  title: string
  body: Parameters<typeof pageShell>[0]['body']
  style?: Parameters<typeof pageShell>[0]['style']
  status: 200 | 404
  policy: string
  width: 'wide' | 'narrow'
}>

/** A page under `/link/`, with no `Link` header: `?lang=` names no page here. */
function show(c: C, target: LinkTarget, page: Shown) {
  const { status, policy, ...rest } = page
  c.header('Content-Security-Policy', policy)
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  return c.html(
    pageShell({
      ...rest,
      lang: langOf(c),
      url: switchUrlOf(c, target.rest),
    }),
    status,
  )
}

/**
 * The page of the event the address stands for, as `/events/:id` shows it,
 * or null when there is no event or it has no public talk. Of the events an
 * address of another site may be kept as, the first with a public talk.
 */
async function eventPage(c: C, target: LinkTarget) {
  const viewer = (await currentOwner(c))?.userId ?? null
  for (const id of await findEventIdsByKey(c.env.DB, eventKeysOf(target))) {
    const read = await readEventPage(c.env.DB, id, viewer)
    if (read) return shownEvent(c, target, read)
  }
  return null
}

async function shownEvent(
  c: C,
  target: LinkTarget,
  read: NonNullable<Awaited<ReturnType<typeof readEventPage>>>,
) {
  const eventId = read.event.id
  const community =
    (await listEventCommunities(c.env.DB, [eventId])).get(eventId) ?? null
  const lang = langOf(c)
  const contentBase = contentBaseOf(c.env)
  return show(c, target, {
    title: eventPageTitle(read.event, lang),
    body: eventPageBody(
      {
        ...read,
        community: community && {
          ...community,
          href: communityHref(community.handle),
        },
        cover: community
          ? communityCoverOf(community)
          : defaultEventCover(eventId),
        contentBase,
      },
      lang,
    ),
    status: 200,
    policy: homePagePolicy(contentBase),
    width: 'wide',
  })
}

/** The page of an address no slides are gathered at (F45-AC12). */
function missing(c: C, target: LinkTarget) {
  countNotFound(c)
  const lang = langOf(c)
  return show(c, target, {
    title: linkMissingTitle(lang),
    body: linkMissingBody(`https://${target.rest}`, lang),
    style: linkMissingStyle,
    status: 404,
    policy: PAGE_POLICY,
    width: 'narrow',
  })
}

/** The pages of links, open to everyone (F45). */
export const linkPageRoutes = new Hono<{ Bindings: Env }>()

/**
 * Where the footer's language switch of a page of links lands (F45-AC34).
 * The language middleware has kept `?lang=`; this sends the reader back.
 * `to` is read as a page of links and answered with its one path, which
 * starts `/link/<host>`: nothing else, so no other site, is led to.
 * Registered before `/link/*`, which would also match `/link`.
 */
linkPageRoutes.get('/link', (c) => {
  const to = c.req.query('to') ?? ''
  const read = to.startsWith(PREFIX)
    ? parseLinkPath(to.slice(PREFIX.length))
    : null
  if (!read || read.kind === 'refused') return refused(c)
  return c.redirect(linkPagePath(read.url), 302)
})

/**
 * The page of the links to one address. For now only an event has one; any
 * other address answers the page of F45-AC12. The order is F45-AC13's:
 * refuse, move, then the page.
 */
linkPageRoutes.get('/link/*', async (c) => {
  const read = parseLinkPath(sentRestOf(c))
  if (read.kind === 'refused') return refused(c)
  const target = linkTargetOf(read.url)
  const moved = await movedTo(c.env.DB, sentRestOf(c), target)
  if (moved !== null) return c.redirect(moved, 301)
  return (await eventPage(c, target)) ?? missing(c, target)
})
