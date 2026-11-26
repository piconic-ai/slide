import { Hono, type Context } from 'hono'
import { csrf } from 'hono/csrf'
import { currentOwner } from '../auth/owner-middleware'
import { renderPage } from '../decks/pages'
import { readProfile } from '../profile/store'
import { returnToShare } from '../share/path'
import { findAuthor, findVisibleAuthor } from '../share/store'
import { formOnly } from '../site/form-only-middleware'
import { signedOut } from '../site/form-response-routes'
import { langOf } from '../site/lang'
import { blockFormBody, blockSignInBody, blockTitle } from './pages'
import { block, unblock } from './store'

export const blockForms = new Hono<{ Bindings: Env }>()

/** Where blocking was asked from: a share or profile path, else /my/slides. */
const backOf = (input: unknown) => returnToShare(input)

function signInPage(c: Context<{ Bindings: Env }>, back: string) {
  const lang = langOf(c)
  return renderPage(c, blockTitle(lang), blockSignInBody(back, lang), 401)
}

/**
 * The question before blocking. An unknown, suspended or malformed handle
 * and the reader's own handle answer 404 alike.
 */
blockForms.get('/new', async (c) => {
  const author = await findVisibleAuthor(c.env.DB, c.req.query('handle'))
  if (!author) return c.notFound()
  const owner = await currentOwner(c)
  if (owner?.userId === author.userId) return c.notFound()
  const back = backOf(c.req.query('slide'))
  if (!owner) return signInPage(c, back)
  const profile = await readProfile(c.env.DB, author.userId)
  const lang = langOf(c)
  return renderPage(
    c,
    blockTitle(lang),
    blockFormBody(
      {
        handle: author.handle,
        name: profile?.name ?? null,
        avatarUrl: profile?.avatarUrl ?? null,
      },
      back,
      lang,
    ),
    200,
    undefined,
    'narrow',
  )
})

/**
 * Blocks and returns to where the question was asked. Asking about oneself
 * or a handle nobody visible holds changes nothing and answers the same.
 */
blockForms.post('/', formOnly, csrf(), async (c) => {
  const form = await c.req.parseBody({ all: true })
  const back = backOf(form.slide)
  const owner = await currentOwner(c)
  if (!owner) return signedOut(c, () => signInPage(c, back))
  const author = await findVisibleAuthor(c.env.DB, form.handle)
  if (author)
    await block(c.env.DB, {
      blocker: owner.userId,
      blocked: author.userId,
      now: Math.floor(Date.now() / 1000),
    })
  return c.redirect(back, 303)
})

/** Unblocks, from the settings, and returns there. */
blockForms.post('/:handle/release', formOnly, csrf(), async (c) => {
  const owner = await currentOwner(c)
  if (!owner) return signedOut(c, () => c.redirect('/settings', 303))
  // A suspended person can be unblocked too, so the list can always shrink.
  const author = await findAuthor(c.env.DB, c.req.param('handle'))
  if (author)
    await unblock(c.env.DB, { blocker: owner.userId, blocked: author.userId })
  return c.redirect('/settings#blocks', 303)
})
