import type { Context } from 'hono'
import type { Owner } from '../auth/owner-session'
import { deckSlugSchema } from '../decks/deck-id'
import { readNewestVersion, resolveEmbeds } from './embed-store'
import { embeddedPages, parseArticle, renderArticle } from './markdown'
import { toViewerCitations } from '../citations/cards'
import { contentBaseOf } from '../preview/config'
import { deploymentOrigin } from '../preview/origin'
import { readVersionCard } from '../preview/owner-view-store'
import { handleSchema } from '../share/handle'
import { previewImageUrl, coverUrl } from '../share/cover'
import {
  UNAVAILABLE_POLICY,
  viewerPage,
  viewerPolicy,
  unavailablePage,
} from '../share/pages'
import { sharePath } from '../share/path'
import { readHandle, readSharedDeployment } from '../share/store'
import { readViewerParts } from '../share/viewer-parts-store'
import { alternateLinks } from '../site/i18n'
import { langOf } from '../site/lang'

type PreviewEnv = { Bindings: Env; Variables: { owner: Owner } }

/**
 * The article as readers will see it: the viewer of the slides, drawn by the
 * same page function with the same parts, but with the text the author has
 * in the box, which is not saved. It writes nothing and is for the author
 * alone (the caller has checked whose slides they are).
 *
 * The slides run in their frame when readers can see them now: the frame is
 * the public version's, which asks for no session. Slides readers do not see
 * run only for their author through a one-time session that is a row in D1,
 * which a preview does not make; there the cover stands in for the frame.
 */
export async function showViewerPreview(
  c: Context<PreviewEnv>,
  deck: Readonly<{ id: string; slug: string }>,
  owner: Owner,
  body: string,
) {
  const lang = langOf(c)
  const base = contentBaseOf(c.env)
  const handleOf = await readHandle(c.env.DB, owner.userId)
  const handle = handleOf && handleSchema.parse(handleOf)
  const slug = deckSlugSchema.parse(deck.slug)
  if (!base || !handle) {
    c.header('Content-Security-Policy', UNAVAILABLE_POLICY)
    return c.html(unavailablePage(lang, new URL(c.req.url)), 404)
  }
  const shared = await readSharedDeployment(c.env.DB, handle, slug)
  const newest = shared ? null : await readNewestVersion(c.env.DB, deck.id)
  const card = newest
    ? await readVersionCard(c.env.DB, deck.id, newest.id)
    : null
  const version = shared ?? (newest && { ...newest, ...card })
  const deploymentId = version?.id ?? ''
  const parsed = parseArticle(body)
  const embeds = await resolveEmbeds(c.env.DB, {
    pages: embeddedPages(parsed, c.env.PUBLIC_ORIGIN),
    own: { handle, slug, version: version ?? null },
    contentBase: base,
  })
  const parts = version
    ? await readViewerParts(
        c.env.DB,
        {
          deckId: deck.id,
          deploymentId,
          handle,
          slug,
          ownerUserId: owner.userId,
        },
        owner.userId,
      )
    : null
  const shareUrl = new URL(sharePath(handle, slug), c.env.PUBLIC_ORIGIN).href
  const contentOrigin = deploymentOrigin(base, deploymentId || deck.id)
  const cover = version
    ? coverUrl(base, version.id, version.coverPath ?? null)
    : null
  c.header(
    'Content-Security-Policy',
    viewerPolicy(contentOrigin, base, false, true),
  )
  c.header('Cache-Control', 'private, no-store')
  c.header('X-Robots-Tag', 'noindex')
  c.header('Link', alternateLinks(c.env.PUBLIC_ORIGIN, new URL(c.req.url)))
  return c.html(
    viewerPage(
      {
        handle,
        slug,
        title: version?.title ?? null,
        description: version?.description ?? null,
        imageUrl: new URL(
          version ? previewImageUrl(base, version, null) : '/covers/none.jpg',
          c.env.PUBLIC_ORIGIN,
        ).href,
        shareUrl,
        contentUrl: `${contentOrigin}/`,
        launch: null,
        preview: null,
        articlePreview: {
          action: `/slides/${deck.slug}/article`,
          body,
        },
        // Only the slides readers can open run in a frame.
        coverFace: shared ? null : { imageUrl: cover },
        controls: 'none',
        editPath: null,
        author: {
          name: parts?.author?.name ?? null,
          avatarUrl: parts?.author?.avatarUrl ?? null,
        },
        citations: parts
          ? toViewerCitations(parts.citations, base, parts.citations.counts)
          : toViewerCitations(
              { cites: [], citedBy: { decks: [], total: 0 } },
              base,
            ),
        links: parts?.links ?? [],
        // What readers will see: published, so no tag for a draft.
        article: {
          html: renderArticle(parsed, {
            origin: c.env.PUBLIC_ORIGIN,
            embeds,
            lang,
          }),
          status: 'published',
        },
      },
      lang,
      new URL(c.req.url),
    ),
  )
}
