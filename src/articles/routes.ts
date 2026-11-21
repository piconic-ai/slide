import { Hono, type Context } from 'hono'
import { raw } from 'hono/html'
import { csrf } from 'hono/csrf'
import { currentOwner, requireOwner } from '../auth/owner-middleware'
import type { Owner } from '../auth/owner-session'
import { linkedShareUrls, embeddedPages, renderArticle } from './markdown'
import { actionOf, checkBody, missingPages, statusAfter } from './article'
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
    preview: boolean
    notice: EditNotice | null
    status: 200 | 400
  }>,
) {
  const lang = langOf(c)
  const [article, [summary], handle, version] = await Promise.all([
    readArticle(c.env.DB, deck.id),
    listOwnDecks(c.env.DB, owner.userId, deck.slug),
    readHandle(c.env.DB, owner.userId),
    readNewestVersion(c.env.DB, deck.id),
  ])
  const body = input.body ?? article?.body ?? ''
  const contentBase = contentBaseOf(c.env)
  const pages = embeddedPages(body, c.env.PUBLIC_ORIGIN)
  const embeds =
    input.preview && handle
      ? await resolveEmbeds(c.env.DB, {
          pages,
          own: { handle, slug: deck.slug, version },
          contentBase,
        })
      : new Map()
  const view: EditView = {
    slug: deck.slug,
    deckName: summary ? ownDeckName(summary) : deck.slug,
    article,
    body,
    // The one place Markdown becomes HTML: only what renderArticle allows.
    preview: input.preview
      ? raw(renderArticle(body, { origin: c.env.PUBLIC_ORIGIN, embeds, lang }))
      : null,
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
    preview: false,
    notice: RESULTS[c.req.query('result') ?? ''] ?? null,
    status: 200,
  })
})

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
  const sent = typeof form.body === 'string' ? form.body : null
  const asked = String(form.action ?? '')
  const back = (result: string) =>
    c.redirect(`/slides/${deck.slug}/article?result=${result}`, 303)

  if (asked === 'unpublish') {
    await unpublishArticle(c.env.DB, deck.id)
    return back('unpublished')
  }
  if (asked === 'write' || asked === 'preview')
    return showEditor(c, deck, owner, {
      body: sent,
      preview: asked === 'preview',
      notice: null,
      status: 200,
    })
  const action = actionOf(asked)
  if (action === null || action === 'unpublish' || sent === null)
    return showEditor(c, deck, owner, {
      body: sent,
      preview: false,
      notice: null,
      status: 400,
    })
  const checked = checkBody(sent, { publishing: action === 'publish' })
  if (!checked.ok)
    return showEditor(c, deck, owner, {
      body: sent,
      preview: false,
      notice: checked.reason,
      status: 400,
    })
  const [current, handle] = await Promise.all([
    readArticle(c.env.DB, deck.id),
    readHandle(c.env.DB, owner.userId),
  ])
  const status = statusAfter(current?.status ?? null, action)
  const links = linkedShareUrls(checked.body, c.env.PUBLIC_ORIGIN)
  await keepArticle(c.env.DB, {
    deckId: deck.id,
    body: checked.body,
    status,
    // A link to the article's own slides is no citation.
    citations: links.filter(
      (link) => !(link.handle === handle && link.slug === deck.slug),
    ),
    now: now(),
  })
  return back(action === 'publish' ? 'published' : 'saved')
})
