import type { Context } from 'hono'
import type { Owner } from '../auth/owner-session'
import { deckSlugSchema, type DeckSlug } from '../decks/deck-id'
import { readNewestVersion, resolveEmbeds } from './embed-store'
import { viewerArticleSection } from './viewer-article'
import { embeddedPages, parseArticle, renderArticle } from './markdown'
import { toViewerCitations } from '../citations/cards'
import { contentBaseOf } from '../preview/config'
import { deploymentOrigin } from '../preview/origin'
import { readVersionCard } from '../preview/owner-view-store'
import { handleSchema, type Handle } from '../share/handle'
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

type Deck = Readonly<{ id: string; slug: string }>

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
const EMPTY_CITATIONS = { cites: [], citedBy: { decks: [], total: 0 } } as const

/**
 * The version the preview shows: the one readers see when there is one (it
 * runs in a frame), else the newest the author has (its cover stands in).
 */
async function versionOf(
  database: D1Database,
  deck: Deck,
  handle: Handle,
  slug: DeckSlug,
) {
  const shared = await readSharedDeployment(database, handle, slug)
  if (shared) return { version: shared, public: true as const }
  const newest = await readNewestVersion(database, deck.id)
  const card = newest
    ? await readVersionCard(database, deck.id, newest.id)
    : null
  return { version: newest && { ...newest, ...card }, public: false as const }
}

type Version = NonNullable<Awaited<ReturnType<typeof versionOf>>['version']>

/** The cover that stands in for slides that are not run in a frame. */
const faceOf = (version: Version | null, base: URL, isPublic: boolean) =>
  isPublic
    ? null
    : {
        imageUrl: version
          ? coverUrl(base, version.id, version.coverPath ?? null)
          : null,
      }

/** The image a service shows for these slides, for the page's head. */
const imageOf = (version: Version | null, base: URL, origin: string) =>
  new URL(
    version ? previewImageUrl(base, version, null) : '/covers/none.jpg',
    origin,
  ).href

export async function showViewerPreview(
  c: Context<PreviewEnv>,
  deck: Deck,
  owner: Owner,
  body: string,
  /** The revision the text was written on, for the way back. */
  known: number | null,
) {
  const lang = langOf(c)
  const base = contentBaseOf(c.env)
  const handle = handleSchema.safeParse(
    await readHandle(c.env.DB, owner.userId),
  )
  const slug = deckSlugSchema.parse(deck.slug)
  if (!base || !handle.success) {
    c.header('Content-Security-Policy', UNAVAILABLE_POLICY)
    return c.html(unavailablePage(lang, new URL(c.req.url)), 404)
  }
  const { version, public: isPublic } = await versionOf(
    c.env.DB,
    deck,
    handle.data,
    slug,
  )
  const parsed = parseArticle(body)
  const [embeds, parts] = await Promise.all([
    resolveEmbeds(c.env.DB, {
      pages: embeddedPages(parsed, c.env.PUBLIC_ORIGIN),
      own: { handle: handle.data, slug, version: version ?? null },
      contentBase: base,
    }),
    version
      ? readViewerParts(
          c.env.DB,
          {
            deckId: deck.id,
            deploymentId: version.id,
            handle: handle.data,
            slug,
            ownerUserId: owner.userId,
          },
          owner.userId,
        )
      : null,
  ])
  const contentOrigin = deploymentOrigin(base, version?.id ?? deck.id)
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
        handle: handle.data,
        slug,
        title: version?.title ?? null,
        description: version?.description ?? null,
        imageUrl: imageOf(version ?? null, base, c.env.PUBLIC_ORIGIN),
        shareUrl: new URL(sharePath(handle.data, slug), c.env.PUBLIC_ORIGIN)
          .href,
        contentUrl: `${contentOrigin}/`,
        launch: null,
        preview: null,
        articlePreview: {
          action: `/slides/${deck.slug}/article`,
          body,
          revision: known,
        },
        // Only the slides readers can open run in a frame.
        coverFace: faceOf(version ?? null, base, isPublic),
        controls: 'none',
        editPath: null,
        author: {
          name: parts?.author?.name ?? null,
          avatarUrl: parts?.author?.avatarUrl ?? null,
        },
        citations: toViewerCitations(
          parts?.citations ?? EMPTY_CITATIONS,
          base,
          parts?.citations.counts,
        ),
        links: parts?.links ?? [],
        events: parts?.events ?? [],
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

/**
 * The article as the viewer draws it, without the slides or the side column:
 * the same section (`viewerArticleSection`) the viewer and the preview use,
 * made from the text sent. The editing page shows it beside the box, and the
 * client only puts this HTML in; it never reads Markdown. Reads only.
 */
export async function renderArticlePane(
  c: Context<PreviewEnv>,
  deck: Deck,
  owner: Owner,
  body: string,
): Promise<string> {
  const lang = langOf(c)
  const base = contentBaseOf(c.env)
  const handle = handleSchema.safeParse(
    await readHandle(c.env.DB, owner.userId),
  )
  const parsed = parseArticle(body)
  const found =
    base && handle.success
      ? await versionOf(
          c.env.DB,
          deck,
          handle.data,
          deckSlugSchema.parse(deck.slug),
        )
      : null
  const embeds =
    base && handle.success
      ? await resolveEmbeds(c.env.DB, {
          pages: embeddedPages(parsed, c.env.PUBLIC_ORIGIN),
          own: {
            handle: handle.data,
            slug: deck.slug,
            version: found?.version ?? null,
          },
          contentBase: base,
        })
      : new Map()
  return String(
    viewerArticleSection(
      {
        html: renderArticle(parsed, {
          origin: c.env.PUBLIC_ORIGIN,
          embeds,
          lang,
        }),
        status: 'published',
      },
      lang,
    ),
  )
}
