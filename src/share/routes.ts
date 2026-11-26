import { Hono, type Context } from 'hono'
import { showCommunity, type HandlePath } from '../communities/handle-routes'
import { movedPath } from '../handles/moved'
import { resolveHandle } from '../handles/store'
import { contentBaseOf } from '../preview/config'
import { deploymentOrigin } from '../preview/origin'
import {
  embeddedPages,
  parseArticle,
  renderArticle,
} from '../articles/markdown'
import { readArticle } from '../articles/store'
import { resolveEmbeds } from '../articles/embed-store'
import type { ViewerArticle } from '../articles/viewer-article'
import { toViewerCitations } from '../citations/cards'
import { toViewerTalks } from './viewer-talks'
import {
  countPairs,
  listPairs,
  PAIRS_PER_PAGE,
  readCitedCounts,
} from '../citations/pair-store'
import { readViewerParts } from './viewer-parts-store'
import { chooseOwnerView } from '../preview/owner-view'
import { readOwnerDeck, readVersionCard } from '../preview/owner-view-store'
import { issueLaunch } from '../preview/store'
import { previewImageUrl } from './cover'
import type { Handle } from './handle'
import {
  isSharePath,
  parseSharePath,
  sharePath,
  type CitationList,
  type SharePath,
} from './path'
import {
  followedLinkPage,
  followedLinkPolicy,
  UNAVAILABLE_POLICY,
  unavailablePage,
  type PreviewNotice,
  type UnavailableKind,
  viewerPage,
  viewerPolicy,
} from './pages'
import { currentOwner } from '../auth/owner-middleware'
import { randomToken } from '../auth/owner-session'
import { homePagePolicy, renderPage } from '../decks/pages'
import {
  PROFILE_DECKS_SHOWN,
  profileBody,
  profileTitle,
  type ProfileReader,
  type ProfileView,
} from './list-pages'
import {
  countPublicDecks,
  findVisibleAuthor,
  listPublicDecks,
  readHandleOwner,
  readSharedDeployment,
} from './store'
import type { FollowState, ViewerAuthorState } from '../follows/pages'
import {
  parsePeoplePage,
  PEOPLE_PER_PAGE,
  peopleReaderOf,
} from '../follows/people'
import { isFollowing, listPeople } from '../follows/store'
import { hasMuted } from '../mutes/store'
import { blockedBetween } from '../blocks/store'
import { readProfile, type StoredProfile } from '../profile/store'
import {
  countProfileFollows,
  listProfileCommunities,
  listRecentCommunityTalks,
} from '../profile/communities-store'
import { readSuspension } from '../publication/suspension-store'
import { alternateLinks, LANG_PARAM, langOfTag } from '../site/i18n'
import { z } from 'zod'
import type { DeckSlug } from '../decks/deck-id'
import { recordFrom } from '../metrics/record-routes'
import { langOf } from '../site/lang'

export const shareRoutes = new Hono<{
  Bindings: Env
  Variables: { framedBySelf?: boolean }
}>()

/**
 * The signed-in reader, whose mutes shape the lists on the page. A page made
 * for one reader is marked so that no shared cache keeps it.
 */
async function viewerId<E extends { Bindings: Env }>(c: Context<E>) {
  const owner = await currentOwner(c, { allowSuspended: true })
  if (owner) c.header('Cache-Control', 'private, no-cache')
  return owner?.userId ?? null
}

/** Only an active reader of another author's page can follow or mute. */
async function activeReader(
  database: D1Database,
  viewer: string | null,
  author: string,
) {
  if (viewer === null || viewer === author) return null
  return (await readSuspension(database, viewer)) ? null : viewer
}

async function followState(
  database: D1Database,
  reader: string,
  author: string,
): Promise<FollowState> {
  return (await isFollowing(database, { follower: reader, followee: author }))
    ? 'following'
    : 'can-follow'
}

async function profileFollow(
  database: D1Database,
  viewer: string | null,
  reader: string | null,
  author: string,
): Promise<FollowState | 'refused'> {
  if (viewer === null) return 'signed-out'
  if (reader === null) return 'none'
  const [muted, refused] = await Promise.all([
    hasMuted(database, { muter: reader, muted: author }),
    blockedBetween(database, reader, author),
  ])
  if (muted) return 'none'
  // Only the button says so; nothing tells the reader they were blocked.
  if (refused) return 'refused'
  return followState(database, reader, author)
}

async function profileReader(
  database: D1Database,
  viewer: string | null,
  reader: string | null,
  author: string,
): Promise<ProfileReader> {
  if (viewer === author) return { kind: 'owner' }
  return {
    kind: 'reader',
    follow: await profileFollow(database, viewer, reader, author),
    canBlock: reader !== null,
  }
}

/**
 * The numbers of a profile's citation lists, as this reader sees them, and
 * the page of the list that is open, if one is.
 */
async function readCitationLists(
  database: D1Database,
  query: Readonly<{
    author: string
    /** The author's handle, whose decks' cards carry a count. */
    handle: Handle
    viewer: string | null
    list: CitationList | null
    /** Whether the slides tab is open, whose cards carry a count. */
    slides: boolean
    page: number
  }>,
) {
  const { author, viewer } = query
  const [citing, cited, rows, onCards] = await Promise.all([
    countPairs(database, { side: 'citing', author, viewer }),
    countPairs(database, { side: 'cited', author, viewer }),
    query.list === null
      ? []
      : listPairs(database, {
          side: query.list,
          author,
          viewer,
          limit: PAIRS_PER_PAGE,
          offset: (query.page - 1) * PAIRS_PER_PAGE,
        }),
    // Only the slides tab has cards to count.
    query.slides
      ? readCitedCounts(database, [query.handle], viewer)
      : new Map<string, number>(),
  ])
  return { counts: { citing, cited }, rows, onCards }
}

/** How many recent slides each community on the tab shows (D-53). */
const FOLLOWED_COMMUNITY_TALKS = 4

/**
 * One page of the communities an author follows or runs, with the newest
 * slides of each as this reader may see them (F31-AC8).
 */
async function readProfileCommunities(
  database: D1Database,
  query: Readonly<{ of: string; viewer: string | null; page: number }>,
) {
  const communities = await listProfileCommunities(database, {
    ...query,
    limit: PEOPLE_PER_PAGE,
    offset: (query.page - 1) * PEOPLE_PER_PAGE,
  })
  const talks = await listRecentCommunityTalks(database, {
    communityIds: communities.map((community) => community.id),
    viewer: query.viewer,
    each: FOLLOWED_COMMUNITY_TALKS,
  })
  return { communities, talks }
}

type ProfilePath = Extract<
  SharePath,
  { kind: 'profile' | 'people' | 'citations' | 'communities' }
>

const isProfilePath = (path: SharePath): path is ProfilePath =>
  path.kind === 'profile' ||
  path.kind === 'people' ||
  path.kind === 'citations' ||
  path.kind === 'communities'

/**
 * An author's profile, open at their slides or at one of their lists of
 * people. The lists are public; a signed-in reader's mutes shape the lists
 * and the counts they see. When nobody visible holds the handle, or the
 * list's page is not one, `unavailable` answers.
 */
async function showProfile<E extends { Bindings: Env }>(
  c: Context<E>,
  path: ProfilePath,
  unavailable: () => Response | Promise<Response>,
) {
  const url = new URL(c.req.url)
  // Every list has pages; the slides have one.
  const page =
    path.kind === 'profile' ? 1 : parsePeoplePage(url.searchParams.get('page'))
  const author = await findVisibleAuthor(c.env.DB, path.handle)
  if (!author || page === null) return unavailable()
  const database = c.env.DB
  const base = contentBaseOf(c.env)
  const viewer = await viewerId(c)
  // Who may follow and unfollow on this page: a reader who is not stopped.
  const active =
    viewer !== null && !(await readSuspension(database, viewer)) ? viewer : null
  const people = { of: author.userId, viewer }
  const [profile, slides, decks, reader, counts, listed, followed] =
    await Promise.all([
      readProfile(database, author.userId),
      countPublicDecks(database, path.handle),
      listPublicDecks(database, {
        handle: path.handle,
        limit: PROFILE_DECKS_SHOWN,
      }),
      profileReader(database, viewer, active, author.userId),
      countProfileFollows(database, people),
      path.kind === 'people'
        ? listPeople(database, {
            ...people,
            list: path.list,
            limit: PEOPLE_PER_PAGE,
            offset: (page - 1) * PEOPLE_PER_PAGE,
          })
        : null,
      path.kind === 'communities'
        ? readProfileCommunities(database, { ...people, page })
        : null,
    ])
  const cited = await readCitationLists(database, {
    author: author.userId,
    handle: path.handle,
    viewer,
    list: path.kind === 'citations' ? path.list : null,
    slides: path.kind === 'profile',
    page,
  })
  const view: ProfileView =
    path.kind === 'people'
      ? {
          kind: 'people',
          list: path.list,
          people: listed ?? [],
          page,
          reader: peopleReaderOf(viewer, active),
        }
      : path.kind === 'citations'
        ? {
            kind: 'citations',
            list: path.list,
            rows: cited.rows,
            page,
            contentBase: base,
          }
        : followed !== null
          ? {
              kind: 'communities',
              ...followed,
              page,
              reader: peopleReaderOf(viewer, active),
              contentBase: base,
            }
          : { kind: 'slides', decks, contentBase: base, citedBy: cited.onCards }
  const lang = langOf(c)
  c.header('Link', alternateLinks(c.env.PUBLIC_ORIGIN, url))
  return renderPage(
    c,
    profileTitle(path.handle, view, lang),
    profileBody(
      {
        handle: path.handle,
        profile,
        counts: {
          slides,
          ...counts,
          ...cited.counts,
        },
      },
      view,
      reader,
      lang,
    ),
    200,
    homePagePolicy(base),
  )
}

async function deckControls(
  database: D1Database,
  viewer: string | null,
  author: string,
): Promise<ViewerAuthorState> {
  if (viewer === null) return 'signed-out'
  const reader = await activeReader(database, viewer, author)
  if (reader === null) return 'none'
  const [muted, follow] = await Promise.all([
    hasMuted(database, { muter: reader, muted: author }),
    followState(database, reader, author),
  ])
  return muted ? 'muted' : follow
}

/** The canonical path, carrying the language the reader chose, if any. */
const withChosenLang = (path: string, chosen: string | undefined) =>
  chosen ? `${path}?${LANG_PARAM}=${chosen}` : path

/** What the viewer shows of a deck's author, whose profile may be missing. */
const authorShown = (profile: StoredProfile | null) => ({
  name: profile?.name ?? null,
  avatarUrl: profile?.avatarUrl ?? null,
})

const now = () => Math.floor(Date.now() / 1000)

/**
 * The article under the slides, as this reader may see it: a published one by
 * anyone who sees the slides, a draft by its author alone. The slides are
 * public or the reader is their author, since the viewer answers nothing
 * else. Its HTML is made here, from the text, by the one renderer.
 */
async function articleFor<E extends { Bindings: Env }>(
  c: Context<E>,
  deck: Readonly<{
    deckId: string
    handle: Handle
    slug: DeckSlug
    version: Readonly<{
      id: string
      coverPath: string | null
    }>
    seenByAuthor: boolean
  }>,
  base: URL,
): Promise<ViewerArticle | null> {
  const stored = await readArticle(c.env.DB, deck.deckId)
  if (!stored || (stored.status === 'draft' && !deck.seenByAuthor)) return null
  const origin = c.env.PUBLIC_ORIGIN
  // Parsed once: the pages and the HTML read the same tokens.
  const parsed = parseArticle(stored.body)
  const embeds = await resolveEmbeds(c.env.DB, {
    pages: embeddedPages(parsed, origin),
    own: { handle: deck.handle, slug: deck.slug, version: deck.version },
    contentBase: base,
  })
  return {
    html: renderArticle(parsed, { origin, embeds, lang: langOf(c) }),
    status: stored.status,
  }
}

type DeckPath = Extract<SharePath, { kind: 'deck' | 'page' }>

/**
 * Whether the request is the author opening the page to read it. The page
 * holds a one-time token, and making it writes a row, so a HEAD, a page
 * loaded ahead of time, and any request that is not a document load are
 * answered as they are for readers.
 */
const readsADocument = (request: {
  method: string
  header(name: string): string | undefined
}) => {
  const dest = request.header('Sec-Fetch-Dest')
  return (
    request.method === 'GET' &&
    request.header('Sec-Purpose') === undefined &&
    (dest === undefined || dest === 'document')
  )
}

/**
 * The viewer of slides only their author may open: a deck with no public
 * version, a paused one, or a version other than the public one, asked for
 * as `?v=<deployment>` by its author. Null for anyone else and for a deck
 * with nothing to show, so those are answered as every reader is. The
 * version in the address is not a secret and appears in no share URL; it
 * names a version, and it opens only for the author.
 */
async function showOwnerPreview<E extends { Bindings: Env }>(
  c: Context<E>,
  input: Readonly<{ path: DeckPath; owner: string | null; base: URL }>,
) {
  const { path, owner, base } = input
  if (
    owner === null ||
    !readsADocument(c.req) ||
    (await readHandleOwner(c.env.DB, path.handle)) !== owner
  )
    return null
  const url = new URL(c.req.url)
  const requested = z.uuid().safeParse(url.searchParams.get('v'))
  const asked = requested.success ? requested.data : null
  const deck = await readOwnerDeck(c.env.DB, {
    ownerUserId: owner,
    slug: path.slug,
    requested: asked,
  })
  if (!deck) return null
  // A version the address names that the deck does not have is not shown
  // as another one.
  if (asked && !deck.versions.some((version) => version.id === asked))
    return 'missing' as const
  const view = chooseOwnerView(deck.state.publication, deck.versions, asked)
  if (!view || view.kind === 'readers') return null
  const card = await readVersionCard(c.env.DB, deck.deckId, view.deploymentId)
  const token = await issueLaunch(c.env.DB, {
    deckId: deck.deckId,
    deploymentId: view.deploymentId,
    ownerUserId: owner,
    now: now(),
  })
  if (!card || !token) return null
  const origin = deploymentOrigin(base, view.deploymentId)
  const page = path.kind === 'page' ? path.page : null
  const launch = new URL('/_preview/launch', origin)
  launch.searchParams.set(LANG_PARAM, langOf(c))
  if (page !== null) launch.searchParams.set('page', String(page))
  return {
    origin,
    deckId: deck.deckId,
    launch: { action: launch.href, token },
    card,
    versionId: view.deploymentId,
    notice: {
      kind: view.kind,
      publish: {
        action: `/slides/${path.slug}/publication`,
        deploymentId: view.deploymentId,
        revision: deck.state.revision,
      },
    } satisfies PreviewNotice,
  }
}

/**
 * The version the viewer shows: the author's own, when only they may see it,
 * or the one readers see. Read from D1 on every view: the pointer decides
 * what readers see.
 */
async function versionShown<E extends { Bindings: Env }>(
  c: Context<E>,
  path: DeckPath,
  viewer: string | null,
  base: URL,
) {
  const owned = await showOwnerPreview(c, { path, owner: viewer, base })
  // A version the address names that the deck does not have is shown as none.
  if (owned === 'missing') return { preview: null, shared: null }
  const shared = owned
    ? {
        id: owned.versionId,
        deckId: owned.deckId,
        ownerUserId: viewer ?? '',
        ...owned.card,
      }
    : await readSharedDeployment(c.env.DB, path.handle, path.slug)
  return { preview: owned, shared }
}

/**
 * The page whose image a viewer offers: none for an author-only version,
 * whose pages are not taken (only public versions are), so it offers its
 * cover.
 */
const pageTaken = (
  preview: Awaited<ReturnType<typeof versionShown>>['preview'],
  page: number | null,
) => (preview ? null : page)

/**
 * People and communities share handles: the table says whose page this is.
 * A community's page, the move from a handle an operator changed, or a
 * person's profile and lists are answered here; a deck's path is left to
 * the viewer.
 */
async function routeByHolder<E extends { Bindings: Env }>(
  c: Context<E>,
  path: HandlePath,
  url: URL,
  unavailable: (kind?: UnavailableKind) => Response | Promise<Response>,
): Promise<
  | Readonly<{ kind: 'answered'; response: Response }>
  | Readonly<{ kind: 'deck'; path: DeckPath }>
> {
  const holder = await resolveHandle(c.env.DB, path.handle)
  const answered = async (response: Response | Promise<Response>) =>
    ({ kind: 'answered', response: await response }) as const
  if (holder.kind === 'moved')
    return answered(
      c.redirect(
        movedPath(url.pathname, url.search, path.handle, holder.handle),
        301,
      ),
    )
  if (holder.kind === 'community')
    return answered(
      showCommunity(c, { communityId: holder.communityId, path }, () =>
        unavailable(),
      ),
    )
  if (isProfilePath(path))
    return answered(showProfile(c, path, () => unavailable('profile')))
  return { kind: 'deck', path }
}

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
  const unavailable = (kind?: UnavailableKind) => {
    c.header('Content-Security-Policy', UNAVAILABLE_POLICY)
    c.header('X-Robots-Tag', 'noindex')
    return c.html(unavailablePage(lang, url, kind), 404)
  }
  const parsed = parseSharePath(raw)
  // A chosen language survives the move to the canonical spelling, for
  // clients that keep no cookie.
  const chosen = langOfTag(url.searchParams.get(LANG_PARAM) ?? undefined)
  if (parsed.kind === 'redirect')
    return c.redirect(withChosenLang(parsed.path, chosen), 301)
  if (parsed.kind === 'invalid') return unavailable()
  const routed = await routeByHolder(c, parsed, url, unavailable)
  if (routed.kind === 'answered') return routed.response
  const { path } = routed
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
  const viewer = await viewerId(c)
  const { preview, shared } = await versionShown(c, path, viewer, base)
  if (!shared) return unavailable()
  const contentOrigin = deploymentOrigin(base, shared.id)
  const page = path.kind === 'page' ? path.page : null
  const [controls, parts, article] = await Promise.all([
    deckControls(c.env.DB, viewer, shared.ownerUserId),
    // Whoever may open this page may read the links: it is public, or it is
    // the author's own preview.
    readViewerParts(
      c.env.DB,
      {
        deckId: shared.deckId,
        deploymentId: shared.id,
        handle: path.handle,
        slug: path.slug,
        ownerUserId: shared.ownerUserId,
      },
      viewer,
    ),
    articleFor(
      c,
      {
        deckId: shared.deckId,
        handle: path.handle,
        slug: path.slug,
        version: shared,
        seenByAuthor: viewer === shared.ownerUserId,
      },
      base,
    ),
  ])
  const { author, citations, links, events } = parts
  const shownCitations = toViewerCitations(citations, base, citations.counts)
  c.header(
    'Content-Security-Policy',
    viewerPolicy(contentOrigin, base, preview !== null),
  )
  if (preview) {
    // The page holds a one-time token, and shows slides not yet public.
    c.header('Cache-Control', 'private, no-store')
    c.header('X-Robots-Tag', 'noindex')
  }
  c.header('Link', alternateLinks(c.env.PUBLIC_ORIGIN, url))
  // Readers' views only: the author looking at their own slides is no use.
  if (!preview && viewer !== shared.ownerUserId)
    recordFrom(c, {
      name: 'deck_opened',
      via: 'page',
      deckId: shared.deckId,
      referrer: c.req.header('Referer'),
    })
  return c.html(
    viewerPage(
      {
        handle: path.handle,
        slug: path.slug,
        title: shared.title,
        description: shared.description,
        imageUrl: new URL(
          previewImageUrl(base, shared, pageTaken(preview, page)),
          c.env.PUBLIC_ORIGIN,
        ).href,
        shareUrl: new URL(
          sharePath(path.handle, path.slug, page ?? undefined),
          c.env.PUBLIC_ORIGIN,
        ).href,
        // Decks that page by number read it from the fragment.
        contentUrl:
          page === null ? `${contentOrigin}/` : `${contentOrigin}/#${page}`,
        launch: preview?.launch ?? null,
        preview: preview?.notice ?? null,
        controls,
        // Only the author's own session gets the way to editing.
        editPath: viewer === shared.ownerUserId ? `/slides/${path.slug}` : null,
        author: authorShown(author),
        citations: shownCitations,
        links,
        events,
        talks: toViewerTalks(parts.talks, shownCitations, base),
        article,
        articlePreview: null,
        coverFace: null,
        offline: preview === null ? { enabled: true } : null,
      },
      lang,
      url,
    ),
  )
})
