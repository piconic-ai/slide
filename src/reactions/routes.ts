import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { currentOwner, type Owner } from '../auth/owner-session'
import { deckIdSchema, type DeckId } from '../decks/binding'
import { accountTitles, renderPage, signInPrompt } from '../decks/pages'
import { parsePage, sharePath } from '../share/path'
import { readHandle, readSharedDeployment } from '../share/store'
import { langOf } from '../site/lang'
import { resolveHandle, searchPosts } from './bluesky'
import { collectedFrom, defaultQuery } from './collect'
import { manageBody, manageTitle, parseManageResult } from './pages'
import { parsePostUrl, postedAtOf, type Post, type PostLink } from './post'
import {
  addPosts,
  listPosts,
  ownsDeck,
  readCitedPages,
  removePost,
} from './store'

const now = () => Math.floor(Date.now() / 1000)

type FormEnv = { Bindings: Env; Variables: { owner: Owner; deck: DeckId } }

/** Owner pages and forms for the reactions shown under a deck. */
export const reactionForms = new Hono<FormEnv>()

/**
 * Every reactions route is the owner's and names one of their decks. A form
 * posted after the session ended shows the sign-in page; unknown and foreign
 * decks look the same.
 */
reactionForms.use('/:deck/reactions/*', async (c, next) => {
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
  const deck = deckIdSchema.safeParse(c.req.param('deck'))
  if (!deck.success || !(await ownsDeck(c.env.DB, deck.data, owner.userId)))
    return c.text('Deck not found', 404)
  c.set('owner', owner)
  c.set('deck', deck.data)
  await next()
})

/** The deck's share URL while readers can open it, else null. */
async function publicShare(env: Env, owner: Owner, deck: DeckId) {
  const handle = await readHandle(env.DB, owner.userId)
  if (!handle || !(await readSharedDeployment(env.DB, handle, deck)))
    return null
  return {
    handle,
    url: new URL(sharePath(handle, deck), env.PUBLIC_ORIGIN).href,
  }
}

reactionForms.get('/:deck/reactions', async (c) => {
  const deck = c.get('deck')
  const lang = langOf(c)
  const share = await publicShare(c.env, c.get('owner'), deck)
  const [citedBy, posts] = await Promise.all([
    share ? readCitedPages(c.env.DB, share.handle, deck) : [],
    listPosts(c.env.DB, deck),
  ])
  return renderPage(
    c,
    manageTitle(deck, lang),
    manageBody(
      {
        deck,
        defaultQuery: share ? defaultQuery(share.url) : null,
        citedBy,
        posts,
        result: parseManageResult(c.req.query('result'), c.req.query('count')),
      },
      lang,
    ),
  )
})

/** The post a link names, resolving a Bluesky handle to its account. */
async function postOfLink(link: PostLink): Promise<Post | null> {
  if (link.service === 'x') return link
  const did =
    link.actor.kind === 'did'
      ? link.actor.did
      : await resolveHandle(link.actor.handle).catch(() => null)
  return did ? { service: 'bluesky', did, rkey: link.rkey } : null
}

reactionForms.post('/:deck/reactions', csrf(), async (c) => {
  const deck = c.get('deck')
  const back = (result: string) =>
    c.redirect(`/decks/${deck}/reactions?result=${result}`, 303)
  const form = await c.req.parseBody()
  const link = parsePostUrl(String(form.url ?? ''))
  const rawPage = String(form.page ?? '').trim()
  const page = rawPage === '' ? 0 : parsePage(rawPage)
  if (!link || page === null) return back('invalid')
  const post = await postOfLink(link)
  if (!post) return back('unresolved')
  const { added, refused } = await addPosts(
    c.env.DB,
    deck,
    [{ post, page, source: 'pasted', postedAt: postedAtOf(post) }],
    now(),
  )
  if (added) return back('added')
  return back(refused ? 'full' : 'exists')
})

reactionForms.post('/:deck/reactions/collect', csrf(), async (c) => {
  const deck = c.get('deck')
  const back = (result: string) =>
    c.redirect(`/decks/${deck}/reactions?result=${result}`, 303)
  const share = await publicShare(c.env, c.get('owner'), deck)
  if (!share) return back('invalid')
  const form = await c.req.parseBody()
  const query =
    String(form.query ?? '')
      .trim()
      .slice(0, 200) || defaultQuery(share.url)
  let found
  try {
    found = await searchPosts(query)
  } catch {
    return back('search_failed')
  }
  const collected = collectedFrom(
    found,
    { handle: share.handle, slug: deck },
    c.env.PUBLIC_ORIGIN,
  )
  const { added, refused } = await addPosts(
    c.env.DB,
    deck,
    collected.map((item) => ({ ...item, source: 'collected' as const })),
    now(),
  )
  return back(added === 0 && refused ? 'full' : `collected&count=${added}`)
})

reactionForms.post('/:deck/reactions/:id/remove', csrf(), async (c) => {
  const deck = c.get('deck')
  await removePost(c.env.DB, deck, c.req.param('id'))
  return c.redirect(`/decks/${deck}/reactions?result=removed`, 303)
})
