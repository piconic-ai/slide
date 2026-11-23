import { Hono, type Context } from 'hono'
import { csrf } from 'hono/csrf'
import { raw } from 'hono/html'
import { currentOwner, requireOwner } from '../auth/owner-middleware'
import type { Owner } from '../auth/owner-session'
import { MAX_CITATIONS } from '../citations/citation'
import { ownDeckName } from '../decks/own-decks'
import { listOwnDecks } from '../decks/own-decks-store'
import {
  accountTitles,
  deckTitles,
  homePagePolicy,
  notFoundBody,
  renderPage,
  signInPrompt,
} from '../decks/pages'
import { resolveDeck } from '../decks/store'
import { contentBaseOf } from '../preview/config'
import { langOf } from '../site/lang'
import {
  buttonOf,
  checkBody,
  editingBody,
  missingPages,
  normalizeBody,
  revisionOf,
} from './article'
import {
  editBody,
  editTitle,
  type EditNotice,
  type EditView,
} from './edit-page'
import { embeddedPages, linkedShareUrls, parseArticle } from './markdown'
import {
  autosaveArticle,
  discardPendingEdit,
  keepArticle,
  readArticle,
  unpublishArticle,
} from './store'
import { readHandle } from '../share/store'
import { renderArticlePane, showViewerPreview } from './viewer-preview-routes'

type ArticleEnv = { Bindings: Env; Variables: { owner: Owner } }

/** The author's editing page for the article under one of their slides. */
export const articleForms = new Hono<ArticleEnv>()

const now = () => Math.floor(Date.now() / 1000)

const RESULTS: Readonly<Record<string, EditNotice>> = {
  published: 'published',
  updated: 'updated',
  discarded: 'discarded',
  unpublished: 'unpublished',
}

type Deck = Readonly<{ id: string; slug: string }>

async function showEditor(
  c: Context<ArticleEnv>,
  deck: Deck,
  owner: Owner,
  input: Readonly<{
    /** The text the author has in the box; none: what is kept. */
    body: string | null
    notice: EditNotice | null
    status: 200 | 400 | 409
  }>,
) {
  const lang = langOf(c)
  const [article, [summary]] = await Promise.all([
    readArticle(c.env.DB, deck.id),
    listOwnDecks(c.env.DB, owner.userId, deck.slug),
  ])
  const kept = editingBody(article)
  const body = input.body ?? kept
  const contentBase = contentBaseOf(c.env)
  // A text over the limit is only shown back to be shortened, never parsed.
  const fits = checkBody(body, { publishing: false }).ok
  const pages = fits
    ? embeddedPages(parseArticle(body), c.env.PUBLIC_ORIGIN)
    : []
  const view: EditView = {
    slug: deck.slug,
    deckName: summary ? ownDeckName(summary) : deck.slug,
    article,
    body,
    revision: article?.revision ?? null,
    // The side preview is drawn on the page, from the text in the box.
    pane: fits ? raw(await renderArticlePane(c, deck, owner, body)) : null,
    notice: input.notice,
    // The service does not take a version's number of pages yet.
    missing: missingPages(pages, null),
    pageCount: null,
  }
  return renderPage(
    c,
    editTitle(lang),
    editBody(view, lang),
    input.status,
    homePagePolicy(contentBase),
  )
}

articleForms.get('/:deck/article', async (c) => {
  const owner = await currentOwner(c)
  const lang = langOf(c)
  if (!owner)
    return renderPage(
      c,
      accountTitles(lang).signInTitle,
      signInPrompt(lang),
      401,
    )
  const deck = await resolveDeck(c.env.DB, owner.userId, c.req.param('deck'))
  // Unknown, foreign and deleted decks look the same.
  if (!deck || deck.deleted)
    return renderPage(
      c,
      deckTitles(lang).notFoundTitle,
      notFoundBody(lang),
      404,
    )
  return showEditor(c, deck, owner, {
    body: null,
    notice: RESULTS[c.req.query('result') ?? ''] ?? null,
    status: 200,
  })
})

/** What a form sent: the text in the box, the revision it loaded, the button. */
type Sent = Readonly<{
  body: string | null
  known: number | null | undefined
  asked: string
}>

/** The editing page again, or the preview, with the text that was sent. */
function showText(
  c: Context<ArticleEnv>,
  deck: Deck,
  owner: Owner,
  sent: Sent,
) {
  const { body, asked } = sent
  // A text too long to keep is not drawn either: it is as long as it is
  // allowed to be wherever it is sent.
  if (body !== null && !checkBody(body, { publishing: false }).ok)
    return showEditor(c, deck, owner, {
      body,
      notice: 'too_long',
      status: 400,
    })
  // The preview is the viewer itself, drawn from the text sent and saving
  // nothing; "write" is the editing page again with that text.
  if (asked === 'preview' && body !== null)
    return showViewerPreview(c, deck, owner, normalizeBody(body))
  return showEditor(c, deck, owner, { body, notice: null, status: 200 })
}

/** Publishes the text, or updates a publication with it, with its links. */
async function publishText(
  c: Context<ArticleEnv>,
  deck: Deck,
  owner: Owner,
  sent: Sent,
  action: 'publish' | 'update',
) {
  const checked = checkBody(sent.body ?? '', { publishing: true })
  if (!checked.ok)
    return showEditor(c, deck, owner, {
      body: sent.body,
      notice: checked.reason,
      status: 400,
    })
  const [current, handle] = await Promise.all([
    readArticle(c.env.DB, deck.id),
    readHandle(c.env.DB, owner.userId),
  ])
  // Updating needs a publication to update; publishing needs none yet.
  const fits = action === 'update' ? current?.status === 'published' : true
  const links = linkedShareUrls(parseArticle(checked.body), c.env.PUBLIC_ORIGIN)
  const kept =
    fits && sent.known !== undefined
      ? await keepArticle(c.env.DB, {
          deckId: deck.id,
          body: checked.body,
          status: 'published',
          // A link to the article's own slides is no citation. At most as
          // many as a version keeps; the rest are cut.
          citations: links
            .filter(
              (link) => !(link.handle === handle && link.slug === deck.slug),
            )
            .slice(0, MAX_CITATIONS),
          now: now(),
          expectedRevision: sent.known,
        })
      : 'not_kept'
  if (kept === 'not_kept')
    return showEditor(c, deck, owner, {
      body: sent.body,
      notice: 'stale',
      status: 409,
    })
  return c.redirect(
    `/slides/${deck.slug}/article?result=${action === 'publish' ? 'published' : 'updated'}`,
    303,
  )
}

/** Drops the pending edit, or takes the article down, at the revision seen. */
async function changeKept(
  c: Context<ArticleEnv>,
  deck: Deck,
  owner: Owner,
  sent: Sent,
  action: 'discard' | 'unpublish',
) {
  const input = {
    deckId: deck.id,
    known: sent.known ?? -1,
    now: now(),
  }
  const kept =
    sent.known === undefined || sent.known === null
      ? 'not_kept'
      : await (action === 'discard' ? discardPendingEdit : unpublishArticle)(
          c.env.DB,
          input,
        )
  if (kept === 'not_kept')
    return showEditor(c, deck, owner, {
      body: sent.body,
      notice: 'stale',
      status: 409,
    })
  return c.redirect(
    `/slides/${deck.slug}/article?result=${action === 'discard' ? 'discarded' : 'unpublished'}`,
    303,
  )
}

/** The slides of the signed-in author, or the same 404 for any other. */
async function ownDeck(c: Context<ArticleEnv>, owner: Owner) {
  const deck = await resolveDeck(
    c.env.DB,
    owner.userId,
    c.req.param('deck') ?? '',
  )
  return deck && !deck.deleted ? deck : null
}

const notFound = (c: Context<ArticleEnv>) =>
  renderPage(
    c,
    deckTitles(langOf(c)).notFoundTitle,
    notFoundBody(langOf(c)),
    404,
  )

articleForms.post('/:deck/article', csrf(), requireOwner, async (c) => {
  const owner = c.get('owner')
  // Unknown, foreign and deleted decks look the same; nothing is written.
  const deck = await ownDeck(c, owner)
  if (!deck) return notFound(c)
  const form = await c.req.parseBody()
  const sent: Sent = {
    body: typeof form.body === 'string' ? form.body : null,
    known: revisionOf(form.revision),
    asked: String(form.action ?? ''),
  }
  if (sent.asked === 'write' || sent.asked === 'preview')
    return showText(c, deck, owner, sent)
  const action = buttonOf(sent.asked)
  if (action === 'publish' || action === 'update')
    return publishText(c, deck, owner, sent, action)
  if (action === 'discard' || action === 'unpublish')
    return changeKept(c, deck, owner, sent, action)
  return showEditor(c, deck, owner, {
    body: sent.body,
    notice: null,
    status: 400,
  })
})

/** The small answers the page's script reads. */
const reply = (
  c: Context<ArticleEnv>,
  status: 200 | 400 | 404 | 409,
  data: object,
) => c.json(data, status, { 'Cache-Control': 'no-store' })

/**
 * Saves the text as the author types (see `autosaveArticle`): where readers
 * do not see it. The page's script sends the text and the revision it loaded;
 * the answer carries the next revision. A save from a screen that is behind
 * is refused with 409, and nothing is written.
 */
articleForms.post(
  '/:deck/article/autosave',
  csrf(),
  requireOwner,
  async (c) => {
    const owner = c.get('owner')
    const deck = await ownDeck(c, owner)
    if (!deck) return reply(c, 404, { error: 'not_found' })
    const form = await c.req.parseBody()
    const known = revisionOf(form.revision)
    const checked = checkBody(typeof form.body === 'string' ? form.body : '', {
      publishing: false,
    })
    if (typeof form.body !== 'string' || known === undefined)
      return reply(c, 400, { error: 'invalid' })
    if (!checked.ok) return reply(c, 400, { error: checked.reason })
    const saved = await autosaveArticle(c.env.DB, {
      deckId: deck.id,
      body: checked.body,
      known,
      now: now(),
    })
    return saved.result === 'conflict'
      ? reply(c, 409, { error: 'conflict' })
      : reply(c, 200, {
          revision: saved.revision,
          pending: saved.pending,
          savedAt: now(),
        })
  },
)

/**
 * The article as the viewer draws it, from the text sent, as HTML for the
 * page to put beside the box. Reads only; nothing is saved.
 */
articleForms.post('/:deck/article/render', csrf(), requireOwner, async (c) => {
  const owner = c.get('owner')
  const deck = await ownDeck(c, owner)
  if (!deck) return reply(c, 404, { error: 'not_found' })
  const form = await c.req.parseBody()
  const checked = checkBody(typeof form.body === 'string' ? form.body : '', {
    publishing: false,
  })
  if (typeof form.body !== 'string') return reply(c, 400, { error: 'invalid' })
  if (!checked.ok) return reply(c, 400, { error: checked.reason })
  c.header('Cache-Control', 'no-store')
  return c.html(await renderArticlePane(c, deck, owner, checked.body))
})
