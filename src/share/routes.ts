import { Hono } from 'hono'
import { contentBaseOf } from '../preview/config'
import { deploymentOrigin } from '../preview/origin'
import { isSharePath, parseSharePath, sharePath } from './path'
import {
  followedLinkPage,
  followedLinkPolicy,
  UNAVAILABLE_POLICY,
  unavailablePage,
  viewerPage,
  viewerPolicy,
} from './pages'
import { currentOwner, randomToken } from '../auth/owner-session'
import { renderPage } from '../decks/pages'
import { PROFILE_DECKS_SHOWN, profileBody } from './list-pages'
import { listPublicDecks, readHandleOwner, readSharedDeployment } from './store'
import { alternateLinks, LANG_PARAM, langOfTag } from '../site/i18n'
import { langOf } from '../site/lang'
import { DECKS_SHOWN, shorten as shortenDecks } from '../reactions/citing'
import { timelineOf } from '../reactions/timeline'
import {
  deckOriginsOf,
  embedOriginsOf,
  type ReactionsView,
} from '../reactions/pages'
import { listPosts, readCitedBy, readCites } from '../reactions/store'
import { readDeckEvents } from '../events/store'
import { talkOriginsOf, type EventView } from '../events/pages'

export const shareRoutes = new Hono<{
  Bindings: Env
  Variables: { framedBySelf?: boolean }
}>()

/**
 * Every path under `/@`, however spelled, is answered here: the viewer, a
 * redirect to the canonical spelling, or the one unavailable page.
 */
shareRoutes.get('*', async (c, next) => {
  const raw = new URL(c.req.url).pathname
  if (!isSharePath(raw)) return next()
  // Readers revalidate, so a stop or replacement shows on the next visit.
  c.header('Cache-Control', 'no-cache')
  const lang = langOf(c)
  const url = new URL(c.req.url)
  const unavailable = () => {
    c.header('Content-Security-Policy', UNAVAILABLE_POLICY)
    c.header('X-Robots-Tag', 'noindex')
    return c.html(unavailablePage(lang, url), 404)
  }
  const path = parseSharePath(raw)
  // A chosen language survives the move to the canonical spelling, for
  // clients that keep no cookie.
  const chosen = langOfTag(url.searchParams.get(LANG_PARAM) ?? undefined)
  if (path.kind === 'redirect')
    return c.redirect(
      chosen ? `${path.path}?${LANG_PARAM}=${chosen}` : path.path,
      301,
    )
  if (path.kind === 'invalid') return unavailable()
  if (path.kind === 'profile') {
    const userId = await readHandleOwner(c.env.DB, path.handle)
    if (!userId) return unavailable()
    const [decks, owner] = await Promise.all([
      listPublicDecks(c.env.DB, {
        handle: path.handle,
        limit: PROFILE_DECKS_SHOWN,
      }),
      currentOwner(c),
    ])
    c.header('Link', alternateLinks(c.env.PUBLIC_ORIGIN, url))
    return renderPage(
      c,
      `@${path.handle}`,
      profileBody(path.handle, decks, owner?.userId === userId, lang),
    )
  }
  // A deck's link to another deck loads in the deck's own frame.
  c.header('Vary', 'Sec-Fetch-Dest', { append: true })
  if (c.req.header('Sec-Fetch-Dest') === 'iframe') {
    const nonce = randomToken()
    c.header('Content-Security-Policy', followedLinkPolicy(nonce))
    c.header('X-Robots-Tag', 'noindex')
    c.set('framedBySelf', true)
    return c.html(followedLinkPage(nonce))
  }
  const base = contentBaseOf(c.env)
  if (!base) return unavailable()
  // Read from D1 on every view: the pointer decides what readers see.
  const shared = await readSharedDeployment(c.env.DB, path.handle, path.slug)
  if (!shared) return unavailable()
  const contentOrigin = deploymentOrigin(base, shared.id)
  const page = path.kind === 'page' ? path.page : null
  const [citedBy, posts, cites, presented] = await Promise.all([
    readCitedBy(c.env.DB, path.handle, path.slug, DECKS_SHOWN),
    listPosts(c.env.DB, path.slug),
    readCites(c.env.DB, shared.id),
    readDeckEvents(c.env.DB, path.slug),
  ])
  const framed = (deck: {
    handle: string
    slug: string
    title: string | null
    deploymentId: string
  }) => ({
    handle: deck.handle,
    slug: deck.slug,
    title: deck.title,
    contentUrl: `${deploymentOrigin(base, deck.deploymentId)}/`,
  })
  const reactions: ReactionsView = {
    timeline: timelineOf(posts),
    citedBy: {
      shown: citedBy.decks.map(framed),
      more: citedBy.total - citedBy.decks.length,
    },
    cites: shortenDecks(cites.map(framed)),
  }
  const events: EventView[] = presented.map(
    ({ talks, talkCount, ...event }) => {
      const shown = talks
        .slice(0, DECKS_SHOWN)
        .map((talk) =>
          talk.kind === 'deck'
            ? { kind: 'deck' as const, deck: framed(talk) }
            : talk,
        )
      return { ...event, talks: { shown, more: talkCount - shown.length } }
    },
  )
  c.header(
    'Content-Security-Policy',
    viewerPolicy(contentOrigin, [
      ...new Set([
        ...deckOriginsOf(reactions),
        ...talkOriginsOf(events),
        ...embedOriginsOf(reactions),
      ]),
    ]),
  )
  c.header('Link', alternateLinks(c.env.PUBLIC_ORIGIN, url))
  return c.html(
    viewerPage(
      {
        handle: path.handle,
        slug: path.slug,
        title: shared.title,
        description: shared.description,
        shareUrl: new URL(
          sharePath(path.handle, path.slug, page ?? undefined),
          c.env.PUBLIC_ORIGIN,
        ).href,
        // Decks that page by number read it from the fragment.
        contentUrl:
          page === null ? `${contentOrigin}/` : `${contentOrigin}/#${page}`,
        reactions,
        events,
      },
      lang,
      url,
    ),
  )
})
