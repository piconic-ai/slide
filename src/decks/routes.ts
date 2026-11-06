import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { z } from 'zod'
import { currentOwner, requireOwner, type Owner } from '../auth/owner-session'
import { beginAuthorization } from '../auth/routes'
import { bindingRequestSchema, deckIdSchema } from './binding'
import { listDeckHistory } from './history-store'
import { listBindings } from './store'

const now = () => Math.floor(Date.now() / 1000)
const beforeSchema = z.coerce.number().int().positive().optional()

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
  const before = beforeSchema.safeParse(c.req.query('before'))
  if (!before.success) return c.json({ error: 'Invalid cursor' }, 400)
  const history =
    deck.success &&
    (await listDeckHistory(c.env.DB, {
      deckId: deck.data,
      ownerUserId: c.get('owner').userId,
      now: now(),
      before: before.data,
    }))
  if (!deck.success || !history) return c.json({ error: 'Deck not found' }, 404)
  return c.json({ deployments: history })
})
