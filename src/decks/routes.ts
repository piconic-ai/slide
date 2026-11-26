import { Hono } from 'hono'
import { bodyLength } from '../articles/article'
import { readArticle } from '../articles/store'
import { csrf } from 'hono/csrf'
import { currentOwner, requireOwner } from '../auth/owner-middleware'
import type { Owner } from '../auth/owner-session'
import { formatCursor, parseCursor, type HistoryEntry } from './history'
import { HISTORY_PAGE_SIZE, listDeckHistory } from './history-store'
import { markDeckDeleted } from './deletion-store'
import { deckListBody, deckListTitle } from './deck-list-page'
import { deckPageBody, deckPageTitle } from './deck-page'
import { ownDeckName } from './own-decks'
import { listOwnDecks } from './own-decks-store'
import {
  accountTitles,
  deckTitles,
  deletionMismatchBody,
  homePagePolicy,
  notFoundBody,
  renderPage,
  signInPrompt,
} from './pages'
import { chosenSlug, parseSlugNotice, type SlugNotice } from './slug-name'
import { canRenameDeck, renameDeck } from './rename-store'
import { listDeckSlugs, resolveDeck } from './store'
import { slideDownloadLinks } from '../exports/links'
import { exportVersions } from '../exports/versions'
import { recordFrom } from '../metrics/record-routes'
import { langOf } from '../site/lang'
import { kindedOf, parseLinkInput, parseLinkRefusal } from '../links/link'
import { addLink, listLinks, removeLink, setLinkKind } from '../links/store'
import { readCalendarsForEventSoon, waitUntilOf } from '../feeds/reader-routes'
import { kindChanges } from '../links/kind-changes'
import { listDeckEvents } from '../events/store'
import { parseResult, pointedId } from '../publication/panel'
import { readHandle } from '../share/store'
import { sharePath } from '../share/path'
import { contentBaseOf } from '../preview/config'
import {
  readLatestReady,
  readPointedVersion,
  readPublication,
} from '../publication/store'
import { readTakedown } from '../publication/takedown-store'

// The deck was just read as live; one deleted in between shows no notice.
const takedownOf = (takedown: Awaited<ReturnType<typeof readTakedown>>) =>
  takedown === 'missing' ? null : takedown

const now = () => Math.floor(Date.now() / 1000)
const nextCursor = (page: readonly HistoryEntry[]) => {
  const last = page.at(-1)
  return page.length === HISTORY_PAGE_SIZE && last
    ? formatCursor({ createdAt: last.createdAt, id: last.deploymentId })
    : null
}

type DeckEnv = { Bindings: Env; Variables: { owner: Owner } }

/** The author's pages for their decks, and the forms on them. */
export const deckForms = new Hono<DeckEnv>()

deckForms.get('/', async (c) => {
  const owner = await currentOwner(c)
  const lang = langOf(c)
  if (!owner)
    return renderPage(
      c,
      accountTitles(lang).signInTitle,
      signInPrompt(lang),
      401,
    )
  const contentBase = contentBaseOf(c.env)
  const [decks, handle] = await Promise.all([
    listOwnDecks(c.env.DB, owner.userId),
    readHandle(c.env.DB, owner.userId),
  ])
  return renderPage(
    c,
    deckListTitle(lang),
    deckListBody(decks, lang, contentBase, handle),
    200,
    homePagePolicy(contentBase),
  )
})

/**
 * The page that connected a repository is gone; slides are added by dropping
 * them on the list. Old links land there.
 */
deckForms.get('/new', (c) => c.redirect('/slides', 303))

deckForms.get('/:deck', async (c) => {
  const owner = await currentOwner(c)
  if (!owner) {
    const lang = langOf(c)
    return renderPage(
      c,
      accountTitles(lang).signInTitle,
      signInPrompt(lang),
      401,
    )
  }
  const deck = await resolveDeck(c.env.DB, owner.userId, c.req.param('deck'))
  const publication =
    deck && (await readPublication(c.env.DB, deck.id, owner.userId))
  const lang = langOf(c)
  const t = deckTitles(lang)
  // Unknown and foreign decks look the same.
  if (!deck || !publication)
    return renderPage(c, t.notFoundTitle, notFoundBody(lang), 404)
  const pointedDeployment = pointedId(publication)
  const contentBase = contentBaseOf(c.env)
  const [
    pointed,
    latest,
    handle,
    [summary],
    takedown,
    renamable,
    links,
    article,
    deckEvents,
  ] = await Promise.all([
    pointedDeployment
      ? readPointedVersion(c.env.DB, deck.id, pointedDeployment)
      : null,
    readLatestReady(c.env.DB, deck.id),
    contentBase ? readHandle(c.env.DB, owner.userId) : null,
    listOwnDecks(c.env.DB, owner.userId, deck.slug),
    readTakedown(c.env.DB, deck.id),
    canRenameDeck(c.env.DB, deck.id),
    listLinks(c.env.DB, deck.id),
    readArticle(c.env.DB, deck.id),
    listDeckEvents(c.env.DB, deck.id),
  ])
  const name = summary ? ownDeckName(summary) : deck.slug
  return renderPage(
    c,
    deckPageTitle(lang),
    deckPageBody(
      {
        slug: deck.slug,
        name,
        handle,
        shareUrl: handle
          ? new URL(sharePath(handle, deck.slug), c.env.PUBLIC_ORIGIN).href
          : null,
        urlName: { renamable, notice: parseSlugNotice(c.req.query('slug')) },
        links: { list: links, notice: parseLinkRefusal(c.req.query('links')) },
        events: deckEvents,
        article: article && { article, length: bodyLength(article.body) },
        publication: {
          state: publication,
          takedown: takedownOf(takedown),
          pointed,
          latest,
          result: parseResult(c.req.query('result')),
          delivery: contentBase !== null,
        },
        downloads: slideDownloadLinks(
          {
            slug: deck.slug,
            versions: exportVersions(publication.publication, pointed, latest),
            hasArticle: article !== null,
          },
          lang,
        ),
      },
      lang,
    ),
    200,
    homePagePolicy(contentBase),
  )
})

/**
 * Changes the URL name of a slide nobody was given the URL of yet. Every
 * outcome goes back to the slide's page, which says what came of it.
 */
deckForms.post('/:deck/slug', csrf(), requireOwner, async (c) => {
  const lang = langOf(c)
  const ownerUserId = c.get('owner').userId
  const deck = await resolveDeck(c.env.DB, ownerUserId, c.req.param('deck'))
  // Unknown and foreign decks look the same.
  if (!deck || deck.deleted)
    return renderPage(
      c,
      deckTitles(lang).notFoundTitle,
      notFoundBody(lang),
      404,
    )
  const back = (slug: string, notice: SlugNotice) =>
    c.redirect(`/slides/${slug}?slug=${notice}`, 303)
  const form = await c.req.parseBody()
  const chosen = chosenSlug(typeof form.slug === 'string' ? form.slug : '')
  if (!chosen.ok) return back(deck.slug, chosen.reason)
  if (chosen.slug === deck.slug) return back(deck.slug, 'renamed')
  const result = await renameDeck(c.env.DB, {
    ownerUserId,
    deckId: deck.id,
    slug: chosen.slug,
  })
  if (result === 'missing')
    return renderPage(
      c,
      deckTitles(lang).notFoundTitle,
      notFoundBody(lang),
      404,
    )
  return result === 'renamed'
    ? back(chosen.slug, 'renamed')
    : back(deck.slug, result)
})

/**
 * Adds a related link to the author's slide. Every outcome goes back to the
 * slide's page; a refusal carries its reason in the address.
 */
deckForms.post('/:deck/links', csrf(), requireOwner, async (c) => {
  const lang = langOf(c)
  const ownerUserId = c.get('owner').userId
  const deck = await resolveDeck(c.env.DB, ownerUserId, c.req.param('deck'))
  // Unknown and foreign decks look the same.
  if (!deck || deck.deleted)
    return renderPage(
      c,
      deckTitles(lang).notFoundTitle,
      notFoundBody(lang),
      404,
    )
  const back = (reason?: string) =>
    c.redirect(
      `/slides/${deck.slug}${reason ? `?links=${reason}` : ''}#links`,
      303,
    )
  const form = await c.req.parseBody()
  const parsed = parseLinkInput({
    kind: form.kind,
    url: form.url,
    title: form.title,
  })
  if (!parsed.ok) return back(parsed.reason)
  const result = await addLink(c.env.DB, {
    deckId: deck.id,
    ownerUserId,
    link: parsed.link,
    now: now(),
  })
  if (result === 'added')
    recordFrom(c, { name: 'related_link_added', deckId: deck.id })
  if (result === 'added' && parsed.link.kind === 'event')
    await readCalendarsForEventSoon(c.env, waitUntilOf(c), parsed.link.event)
  if (result === 'missing')
    return renderPage(
      c,
      deckTitles(lang).notFoundTitle,
      notFoundBody(lang),
      404,
    )
  return back(result === 'added' ? undefined : result)
})

/**
 * Saves the kinds chosen again in the list of related links. A link whose
 * kind changed leaves its event, and joins one when it becomes an event.
 */
deckForms.post('/:deck/links/kinds', csrf(), requireOwner, async (c) => {
  const lang = langOf(c)
  const ownerUserId = c.get('owner').userId
  const deck = await resolveDeck(c.env.DB, ownerUserId, c.req.param('deck'))
  if (!deck || deck.deleted)
    return renderPage(
      c,
      deckTitles(lang).notFoundTitle,
      notFoundBody(lang),
      404,
    )
  const changes = kindChanges(
    await listLinks(c.env.DB, deck.id),
    await c.req.parseBody(),
  )
  if (!changes.ok)
    return c.redirect(`/slides/${deck.slug}?links=kind#links`, 303)
  for (const change of changes.changes) {
    const kinding = kindedOf(change.kind, change.url)
    if (!kinding) continue
    const changed = await setLinkKind(c.env.DB, {
      deckId: deck.id,
      ownerUserId,
      linkId: change.id,
      kinding,
      now: now(),
    })
    if (changed === 'changed' && kinding.kind === 'event')
      await readCalendarsForEventSoon(c.env, waitUntilOf(c), kinding.event)
  }
  return c.redirect(`/slides/${deck.slug}#links`, 303)
})

deckForms.post('/:deck/links/:link/delete', csrf(), requireOwner, async (c) => {
  const lang = langOf(c)
  const ownerUserId = c.get('owner').userId
  const deck = await resolveDeck(c.env.DB, ownerUserId, c.req.param('deck'))
  if (!deck || deck.deleted)
    return renderPage(
      c,
      deckTitles(lang).notFoundTitle,
      notFoundBody(lang),
      404,
    )
  await removeLink(c.env.DB, {
    deckId: deck.id,
    ownerUserId,
    linkId: c.req.param('link'),
  })
  return c.redirect(`/slides/${deck.slug}#links`, 303)
})

deckForms.post('/:deck/delete', csrf(), requireOwner, async (c) => {
  const lang = langOf(c)
  const t = deckTitles(lang)
  const ownerUserId = c.get('owner').userId
  const deck = await resolveDeck(c.env.DB, ownerUserId, c.req.param('deck'))
  // Unknown and foreign decks look the same.
  if (!deck) return renderPage(c, t.notFoundTitle, notFoundBody(lang), 404)
  const form = await c.req.parseBody()
  if (String(form.confirm ?? '').trim() !== deck.slug)
    return renderPage(
      c,
      t.deleteFailedTitle,
      deletionMismatchBody(deck.slug, lang),
      400,
    )
  const result = await markDeckDeleted(c.env.DB, {
    deckId: deck.id,
    ownerUserId,
    now: now(),
  })
  // Unknown and foreign decks look the same.
  if (result === 'not_found')
    return renderPage(c, t.notFoundTitle, notFoundBody(lang), 404)
  return c.redirect('/slides', 303)
})

/** Owner-only JSON API for decks. */
export const deckApi = new Hono<DeckEnv>()

deckApi.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  await next()
})

deckApi.get('/', requireOwner, async (c) => {
  const slugs = await listDeckSlugs(c.env.DB, c.get('owner').userId)
  return c.json({ decks: slugs.map((deck) => ({ deck })) })
})

deckApi.get('/:deck/deployments', requireOwner, async (c) => {
  const ownerUserId = c.get('owner').userId
  const deck = await resolveDeck(c.env.DB, ownerUserId, c.req.param('deck'))
  const raw = c.req.query('before')
  const before = raw === undefined ? undefined : parseCursor(raw)
  if (before === null) return c.json({ error: 'Invalid cursor' }, 400)
  const history =
    deck &&
    (await listDeckHistory(c.env.DB, {
      deckId: deck.id,
      ownerUserId,
      now: now(),
      before,
    }))
  if (!deck || !history) return c.json({ error: 'Deck not found' }, 404)
  return c.json({ deployments: history, nextCursor: nextCursor(history) })
})
