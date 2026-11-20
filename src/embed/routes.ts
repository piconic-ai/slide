import { Hono } from 'hono'
import { contentBaseOf } from '../preview/config'
import { deploymentOrigin } from '../preview/origin'
import { readProfile } from '../profile/store'
import { UNAVAILABLE_POLICY, unavailablePage } from '../share/pages'
import { parseSharePath, sharePath } from '../share/path'
import { readSharedDeployment } from '../share/store'
import { langOf } from '../site/lang'
import { EMBED_PREFIX } from './code'
import { embedPage, embedPolicy } from './pages'

export const embedRoutes = new Hono<{
  Bindings: Env
  Variables: { framedByAnyone?: boolean }
}>()

/**
 * The page a site frames to show public slides, at `/embed` followed by a
 * share path. It answers alike for everyone: the reader's session is not
 * read. Whatever a share URL would not show a reader gets the viewer's own
 * 404, which no site may frame.
 */
embedRoutes.get(`${EMBED_PREFIX}/*`, async (c) => {
  const url = new URL(c.req.url)
  // Readers revalidate, so a stop or replacement shows on the next visit.
  c.header('Cache-Control', 'no-cache')
  const lang = langOf(c)
  const unavailable = () => {
    c.header('Content-Security-Policy', UNAVAILABLE_POLICY)
    c.header('X-Robots-Tag', 'noindex')
    return c.html(unavailablePage(lang, url), 404)
  }
  // The raw path, read as the share path it ends in.
  const path = parseSharePath(url.pathname.slice(EMBED_PREFIX.length))
  if (path.kind === 'redirect')
    return c.redirect(`${EMBED_PREFIX}${path.path}`, 301)
  if (path.kind !== 'deck' && path.kind !== 'page') return unavailable()
  const base = contentBaseOf(c.env)
  if (!base) return unavailable()
  // Read from D1 on every view: the pointer decides what readers see.
  const shared = await readSharedDeployment(c.env.DB, path.handle, path.slug)
  if (!shared) return unavailable()
  const author = await readProfile(c.env.DB, shared.ownerUserId)
  const contentOrigin = deploymentOrigin(base, shared.id)
  const page = path.kind === 'page' ? path.page : undefined
  c.header('Content-Security-Policy', embedPolicy(contentOrigin))
  c.set('framedByAnyone', true)
  return c.html(
    embedPage(
      {
        handle: path.handle,
        name: shared.title ?? path.slug,
        authorName: author?.name ?? null,
        shareUrl: new URL(
          sharePath(path.handle, path.slug, page),
          c.env.PUBLIC_ORIGIN,
        ).href,
        // Decks that page by number read it from the fragment.
        contentUrl:
          page === undefined
            ? `${contentOrigin}/`
            : `${contentOrigin}/#${page}`,
      },
      lang,
    ),
  )
})
