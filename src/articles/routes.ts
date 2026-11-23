import { Hono, type Context } from 'hono'
import { raw } from 'hono/html'
import { csrf } from 'hono/csrf'
import { currentOwner, requireOwner } from '../auth/owner-middleware'
import type { Owner } from '../auth/owner-session'
import { showViewerPreview } from './viewer-preview-routes'
import { MAX_CITATIONS } from '../citations/citation'
import {
  embeddedPages,
  linkedShareUrls,
  parseArticle,
  renderArticle,
} from './markdown'
import {
  actionOf,
  checkBody,
  normalizeBody,
  missingPages,
  statusAfter,
} from './article'
import { readArticle, keepArticle, unpublishArticle } from './store'
import { readNewestVersion, resolveEmbeds } from './embed-store'
import {
  editBody,
  editTitle,
  type EditNotice,
  type EditView,
} from './edit-page'
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
import { readHandle } from '../share/store'
import { langOf } from '../site/lang'

type ArticleEnv = { Bindings: Env; Variables: { owner: Owner } }

/** The author's editing page for the article under one of their slides. */
export const articleForms = new Hono<ArticleEnv>()

const now = () => Math.floor(Date.now() / 1000)

const RESULTS: Readonly<Record<string, EditNotice>> = {
  saved: 'saved',
  published: 'published',
  unpublished: 'unpublished',
}

async function showEditor(
  c: Context<ArticleEnv>,
  deck: Readonly<{ id: string; slug: string }>,
  owner: Owner,
  input: Readonly<{
    body: string | null
    notice: EditNotice | null
    status: 200 | 400
  }>,
) {
  const lang = langOf(c)
  const [article, [summary]] = await Promise.all([
    readArticle(c.env.DB, deck.id),
    listOwnDecks(c.env.DB, owner.userId, deck.slug),
  ])
  const body = input.body ?? article?.body ?? ''
  const contentBase = contentBaseOf(c.env)
  // A text over the limit is only shown back to be shortened, never parsed.
  const pages = checkBody(body, { publishing: false }).ok
    ? embeddedPages(parseArticle(body), c.env.PUBLIC_ORIGIN)
    : []
  const view: EditView = {
    slug: deck.slug,
    deckName: summary ? ownDeckName(summary) : deck.slug,
    article,
    body,
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

type Deck = Readonly<{ id: string; slug: string }>

/** What a form sent: the text in the box, if any, and the button pressed. */
type Sent = Readonly<{ body: string | null; asked: string }>

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

/** Keeps the text, saved or published, with the links it makes as citations. */
async function keepText(
  c: Context<ArticleEnv>,
  deck: Deck,
  owner: Owner,
  action: 'save' | 'publish',
  body: string,
) {
  const checked = checkBody(body, { publishing: action === 'publish' })
  if (!checked.ok)
    return showEditor(c, deck, owner, {
      body,
      notice: checked.reason,
      status: 400,
    })
  const [current, handle] = await Promise.all([
    readArticle(c.env.DB, deck.id),
    readHandle(c.env.DB, owner.userId),
  ])
  const links = linkedShareUrls(parseArticle(checked.body), c.env.PUBLIC_ORIGIN)
  await keepArticle(c.env.DB, {
    deckId: deck.id,
    body: checked.body,
    status: statusAfter(current?.status ?? null, action),
    // A link to the article's own slides is no citation. At most as many as
    // a version keeps; the rest are cut.
    citations: links
      .filter((link) => !(link.handle === handle && link.slug === deck.slug))
      .slice(0, MAX_CITATIONS),
    now: now(),
  })
  return c.redirect(
    `/slides/${deck.slug}/article?result=${action === 'publish' ? 'published' : 'saved'}`,
    303,
  )
}

articleForms.post('/:deck/article', csrf(), requireOwner, async (c) => {
  const owner = c.get('owner')
  const lang = langOf(c)
  const deck = await resolveDeck(c.env.DB, owner.userId, c.req.param('deck'))
  // Unknown, foreign and deleted decks look the same; nothing is written.
  if (!deck || deck.deleted)
    return renderPage(
      c,
      deckTitles(lang).notFoundTitle,
      notFoundBody(lang),
      404,
    )
  const form = await c.req.parseBody()
  const sent: Sent = {
    body: typeof form.body === 'string' ? form.body : null,
    asked: String(form.action ?? ''),
  }
  if (sent.asked === 'unpublish') {
    await unpublishArticle(c.env.DB, deck.id)
    return c.redirect(`/slides/${deck.slug}/article?result=unpublished`, 303)
  }
  if (sent.asked === 'write' || sent.asked === 'preview')
    return showText(c, deck, owner, sent)
  const action = actionOf(sent.asked)
  if (action === 'save' || action === 'publish') {
    if (sent.body !== null) return keepText(c, deck, owner, action, sent.body)
  }
  return showEditor(c, deck, owner, {
    body: sent.body,
    notice: null,
    status: 400,
  })
})
