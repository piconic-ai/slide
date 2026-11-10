import { Hono } from 'hono'
import { contentBaseOf } from '../preview/config'
import { deploymentOrigin } from '../preview/origin'
import { isSharePath, parseSharePath, sharePath } from './path'
import {
  UNAVAILABLE_POLICY,
  unavailablePage,
  viewerPage,
  viewerPolicy,
} from './pages'
import { currentOwner } from '../auth/owner-session'
import { renderPage } from '../decks/pages'
import { PROFILE_DECKS_SHOWN, profileBody } from './list-pages'
import { listPublicDecks, readHandleOwner, readSharedDeployment } from './store'
import { alternateLinks, LANG_PARAM, langOfTag } from '../site/i18n'
import { langOf } from '../site/lang'

export const shareRoutes = new Hono<{ Bindings: Env }>()

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
      200,
      lang,
    )
  }
  const base = contentBaseOf(c.env)
  if (!base) return unavailable()
  // Read from D1 on every view: the pointer decides what readers see.
  const shared = await readSharedDeployment(c.env.DB, path.handle, path.slug)
  if (!shared) return unavailable()
  const contentOrigin = deploymentOrigin(base, shared.id)
  c.header('Content-Security-Policy', viewerPolicy(contentOrigin))
  c.header('Link', alternateLinks(c.env.PUBLIC_ORIGIN, url))
  return c.html(
    viewerPage(
      {
        handle: path.handle,
        slug: path.slug,
        title: shared.title,
        shareUrl: new URL(
          sharePath(path.handle, path.slug),
          c.env.PUBLIC_ORIGIN,
        ).href,
        contentUrl: `${contentOrigin}/`,
      },
      lang,
      url,
    ),
  )
})
