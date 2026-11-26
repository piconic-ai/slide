import { Hono } from 'hono'
import { contentBaseOf } from '../preview/config'
import { deploymentOrigin } from '../preview/origin'
import { readProfile } from '../profile/store'
import { UNAVAILABLE_POLICY, unavailablePage } from '../share/pages'
import { parseSharePath, profilePath, sharePath } from '../share/path'
import { readSharedDeployment } from '../share/store'
import { recordFrom } from '../metrics/record-routes'
import { langOf } from '../site/lang'
import { EMBED_PREFIX, embedCodeOf } from './code'
import {
  OEMBED_LIMIT_ERROR,
  OEMBED_PATH,
  oembedResponse,
  oembedSize,
  parseOEmbedUrl,
} from './oembed'
import { embedPage, embedPolicy } from './pages'
import { embedShapeOf, embedViaOf } from './shape'

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
  // The query is kept, so the shape asked for survives the move.
  if (path.kind === 'redirect')
    return c.redirect(`${EMBED_PREFIX}${path.path}${url.search}`, 301)
  if (path.kind !== 'deck' && path.kind !== 'page') return unavailable()
  const base = contentBaseOf(c.env)
  if (!base) return unavailable()
  // Read from D1 on every view: the pointer decides what readers see.
  const shared = await readSharedDeployment(c.env.DB, path.handle, path.slug)
  if (!shared) return unavailable()
  const author = await readProfile(c.env.DB, shared.ownerUserId)
  const contentOrigin = deploymentOrigin(base, shared.id)
  const page = path.kind === 'page' ? path.page : undefined
  const shape = embedShapeOf(url.searchParams.get('t'))
  c.header('Content-Security-Policy', embedPolicy(contentOrigin))
  c.set('framedByAnyone', true)
  recordFrom(c, {
    name: 'deck_opened',
    via: embedViaOf(shape),
    deckId: shared.deckId,
    referrer: c.req.header('Referer'),
  })
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
        shape,
      },
      lang,
    ),
  )
})

/**
 * oEmbed: tells a site how to embed a share URL it was given. Only public
 * slides are answered, with the code their author would copy; a URL that is
 * no share URL of this service, and slides a share URL would not show, are
 * not found. Given `maxwidth` or `maxheight`, the size reported and the
 * size the code names both fit them; a limit that is no positive number,
 * or a height with no room for slides above the line, is a bad request. Only JSON is spoken.
 */
embedRoutes.get(OEMBED_PATH, async (c) => {
  c.header('Cache-Control', 'no-cache')
  const format = c.req.query('format')
  if (format !== undefined && format !== 'json')
    return c.json({ error: 'Only format=json is supported' }, 501)
  const size = oembedSize(c.req.query('maxwidth'), c.req.query('maxheight'))
  if (!size) return c.json({ error: OEMBED_LIMIT_ERROR }, 400)
  const notFound = () => c.json({ error: 'Not found' }, 404)
  const origin = c.env.PUBLIC_ORIGIN
  const target = parseOEmbedUrl(c.req.query('url'), origin)
  if (!target || !contentBaseOf(c.env)) return notFound()
  const shared = await readSharedDeployment(
    c.env.DB,
    target.handle,
    target.slug,
  )
  if (!shared) return notFound()
  recordFrom(c, { name: 'oembed_served' })
  const author = await readProfile(c.env.DB, shared.ownerUserId)
  const title = shared.title ?? target.slug
  const shareUrl = new URL(sharePath(target.handle, target.slug), origin).href
  return c.json(
    oembedResponse({
      html: embedCodeOf(shareUrl, title, size),
      title,
      authorName: author?.name ?? `@${target.handle}`,
      authorUrl: new URL(profilePath(target.handle), origin).href,
      publicOrigin: origin,
      size,
    }),
  )
})
