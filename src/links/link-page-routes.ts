import { Hono, type Context } from 'hono'
import { currentOwner } from '../auth/owner-middleware'
import { communityCoverOf, communityHref } from '../communities/community'
import { listEventCommunities } from '../communities/event-communities-store'
import { homePagePolicy, PAGE_POLICY } from '../decks/pages'
import { recordFrom } from '../metrics/record-routes'
import { contentBaseOf } from '../preview/config'
import { ERROR_PAGE_POLICY, errorPage } from '../site/error-pages'
import { langOf } from '../site/lang'
import { pageShell } from '../site/shell'
import {
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
import { linkPageBody, linkPageTitle } from './link-page'
import {
  findAliasedKey,
  readEventPageOf,
  readGatheredPage,
  type LinkPage,
} from './link-page-store'

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
 * The page of the event the address stands for, or null when there is no
 * event or it has no public talk. The page of an event has one path
 * (`eventRest`): asked at another, the answer moves there.
 */
async function eventPage(c: C, sent: string, target: LinkTarget) {
  const viewer = (await currentOwner(c))?.userId ?? null
  const read = await readEventPageOf(c.env.DB, target, viewer)
  if (!read) return null
  return target.eventRest !== null && sent !== target.eventRest
    ? c.redirect(PREFIX + target.eventRest, 301)
    : // The language switch comes back to the path of the event, not to the
      // canonical path of the other links.
      shownPage(c, { ...target, rest: target.eventRest ?? target.rest }, read)
}

/**
 * The page of the links gathered by the key of the address, or null when
 * too few slides carry it for a page (F45-AC2).
 */
async function gatheredPage(c: C, target: LinkTarget) {
  const viewer = (await currentOwner(c))?.userId ?? null
  const read = await readGatheredPage(c.env.DB, target, viewer)
  return read && shownPage(c, target, read)
}

async function shownPage(c: C, target: LinkTarget, read: LinkPage) {
  const eventId = read.event.id
  // For now only an event is in a community.
  const community =
    eventId === null
      ? null
      : ((await listEventCommunities(c.env.DB, [eventId])).get(eventId) ?? null)
  const lang = langOf(c)
  const contentBase = contentBaseOf(c.env)
  return show(c, target, {
    title: linkPageTitle(read.event),
    body: linkPageBody(
      {
        ...read,
        community: community && {
          ...community,
          href: communityHref(community.handle),
          cover: communityCoverOf(community),
        },
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
  // The page of an event of another site has the address as written as its
  // path: a `to` written that way goes back there, any other to the one path.
  const target = linkTargetOf(read.url)
  const asWritten = to.slice(PREFIX.length) === target.eventRest
  return c.redirect(PREFIX + (asWritten ? target.eventRest : target.rest), 302)
})

/**
 * The page of the links to one address; an address nothing is gathered at
 * answers the page of F45-AC12. The order is F45-AC13's: refuse, move, then
 * the page: of the event the address stands for, or of the links gathered
 * by its key (F45-AC35). An event of another site is looked up by the
 * address as written before the move to the canonical path, which would
 * compare away what tells it from another event (its `www.`, the form its
 * site's rule rewrites).
 */
linkPageRoutes.get('/link/*', async (c) => {
  const sent = sentRestOf(c)
  const read = parseLinkPath(sent)
  if (read.kind === 'refused') return refused(c)
  const target = linkTargetOf(read.url)
  const written = target.eventShaped ? null : await eventPage(c, sent, target)
  if (written !== null) return written
  const moved = await movedTo(c.env.DB, sent, target)
  if (moved !== null) return c.redirect(moved, 301)
  const event = target.eventShaped ? await eventPage(c, sent, target) : null
  return event ?? (await gatheredPage(c, target)) ?? missing(c, target)
})
