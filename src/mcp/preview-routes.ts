import { Hono } from 'hono'
import { z } from 'zod'
import { currentOwner } from '../auth/owner-middleware'
import {
  accountTitles,
  deckTitles,
  notFoundBody,
  renderPage,
  signInPrompt,
} from '../decks/pages'
import { resolveDeck } from '../decks/store'
import { isPublishable } from '../publication/store'
import { langOf } from '../site/lang'
import { previewBody, previewTitle } from './preview-pages'

/**
 * A link to the author-only preview of one version, which a tool returns
 * to the agent. The preview itself opens only through the form the manage
 * page posts; this page offers that form, to the slide's owner alone.
 */
export const previewLinkRoutes = new Hono<{ Bindings: Env }>()

previewLinkRoutes.get('/slides/:deck/deployments/:id/preview', async (c) => {
  const lang = langOf(c)
  const owner = await currentOwner(c)
  if (!owner)
    return renderPage(
      c,
      accountTitles(lang).signInTitle,
      signInPrompt(lang),
      401,
    )
  const id = z.uuid().safeParse(c.req.param('id'))
  const deck = await resolveDeck(c.env.DB, owner.userId, c.req.param('deck'))
  // Another author's slide, a version of another slide and one that is not
  // ready are all the same answer.
  if (
    !deck ||
    deck.deleted ||
    !id.success ||
    !(await isPublishable(c.env.DB, deck.id, id.data))
  )
    return renderPage(
      c,
      deckTitles(lang).notFoundTitle,
      notFoundBody(lang),
      404,
    )
  return renderPage(
    c,
    previewTitle(lang),
    previewBody(deck.slug, id.data, lang),
    200,
    undefined,
    'narrow',
  )
})
