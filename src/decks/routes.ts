import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { currentOwner, requireOwner, type Owner } from '../auth/owner-session'
import { beginAuthorization } from '../auth/routes'
import { bindingRequestSchema, deckIdSchema } from './binding'
import { formatCursor, parseCursor, type HistoryEntry } from './history'
import { HISTORY_PAGE_SIZE, listDeckHistory } from './history-store'
import { markDeckDeleted } from './deletion'
import {
  deckListBody,
  deletionMismatchBody,
  historyBody,
  notFoundBody,
  renderPage,
  signInPrompt,
} from './pages'
import { listBindings } from './store'
import { parseResult, pointedId } from '../publication/panel'
import { contentBaseOf } from '../preview/config'
import { readPointedVersion, readPublication } from '../publication/store'

const now = () => Math.floor(Date.now() / 1000)
const nextCursor = (page: readonly HistoryEntry[]) => {
  const last = page.at(-1)
  return page.length === HISTORY_PAGE_SIZE && last
    ? formatCursor({ createdAt: last.createdAt, id: last.deploymentId })
    : null
}

type DeckEnv = { Bindings: Env; Variables: { owner: Owner } }

/** Browser form endpoints for connecting a deck to a repository. */
export const deckForms = new Hono<DeckEnv>()

deckForms.post('/connect', csrf(), requireOwner, async (c) => {
  const form = await c.req.parseBody()
  const input = {
    deck: String(form.deck ?? ''),
    repository: String(form.repository ?? '').trim(),
    branches: String(form.branches ?? '')
      .split(/[\s,]+/)
      .filter(Boolean),
  }
  if (!bindingRequestSchema.safeParse(input).success)
    return c.json({ error: 'Invalid deck, repository, or branches' }, 400)
  // GitHub must confirm admin permission with a fresh user authorization.
  return beginAuthorization(c, { kind: 'bind', request: input })
})

deckForms.get('/', async (c) => {
  const owner = await currentOwner(c)
  if (!owner) return renderPage(c, 'ログイン', signInPrompt, 401)
  const decks = await listBindings(c.env.DB, owner.userId)
  return renderPage(c, 'デッキ', deckListBody(owner.login, decks))
})

deckForms.get('/:deck', async (c) => {
  const owner = await currentOwner(c)
  if (!owner) return renderPage(c, 'ログイン', signInPrompt, 401)
  const deck = deckIdSchema.safeParse(c.req.param('deck'))
  const raw = c.req.query('before')
  const before = raw === undefined ? undefined : parseCursor(raw)
  const history =
    deck.success &&
    before !== null &&
    (await listDeckHistory(c.env.DB, {
      deckId: deck.data,
      ownerUserId: owner.userId,
      now: now(),
      before,
    }))
  const publication =
    deck.success && (await readPublication(c.env.DB, deck.data, owner.userId))
  // Unknown and foreign decks look the same.
  if (!deck.success || !history || !publication)
    return renderPage(c, '見つかりません', notFoundBody, 404)
  const pointedDeployment = pointedId(publication)
  const pointed = pointedDeployment
    ? await readPointedVersion(c.env.DB, deck.data, pointedDeployment)
    : null
  return renderPage(
    c,
    `${deck.data} の履歴`,
    historyBody(deck.data, history, nextCursor(history), {
      state: publication,
      pointed,
      result: parseResult(c.req.query('result')),
      delivery: contentBaseOf(c.env) !== null,
    }),
  )
})

deckForms.post('/:deck/delete', csrf(), requireOwner, async (c) => {
  const deck = deckIdSchema.safeParse(c.req.param('deck'))
  if (!deck.success) return renderPage(c, '見つかりません', notFoundBody, 404)
  const form = await c.req.parseBody()
  if (String(form.confirm ?? '').trim() !== deck.data)
    return renderPage(
      c,
      '削除できませんでした',
      deletionMismatchBody(deck.data),
      400,
    )
  const result = await markDeckDeleted(c.env.DB, {
    deckId: deck.data,
    ownerUserId: c.get('owner').userId,
    now: now(),
  })
  // Unknown and foreign decks look the same.
  if (result === 'not_found')
    return renderPage(c, '見つかりません', notFoundBody, 404)
  return c.redirect('/decks', 303)
})

/** Owner-only JSON API for decks. */
export const deckApi = new Hono<DeckEnv>()

deckApi.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  await next()
})

deckApi.get('/', requireOwner, async (c) =>
  c.json({ decks: await listBindings(c.env.DB, c.get('owner').userId) }),
)

deckApi.get('/:deck/deployments', requireOwner, async (c) => {
  const deck = deckIdSchema.safeParse(c.req.param('deck'))
  const raw = c.req.query('before')
  const before = raw === undefined ? undefined : parseCursor(raw)
  if (before === null) return c.json({ error: 'Invalid cursor' }, 400)
  const history =
    deck.success &&
    (await listDeckHistory(c.env.DB, {
      deckId: deck.data,
      ownerUserId: c.get('owner').userId,
      now: now(),
      before,
    }))
  if (!deck.success || !history) return c.json({ error: 'Deck not found' }, 404)
  return c.json({ deployments: history, nextCursor: nextCursor(history) })
})
