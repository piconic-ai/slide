import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { z } from 'zod'
import { requireOwner, type Owner } from '../auth/owner-session'
import { deckIdSchema } from '../decks/binding'
import { applyAuthorCommand, type AuthorResult } from './author'
import { readPublication } from './store'
import type { AuthorCommand } from './transitions'

const revisionSchema = z.number().int().nonnegative()

/** The body of an author publication request. */
export const authorRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('publish'),
    deploymentId: z.uuid(),
    expectedRevision: revisionSchema,
  }),
  z.strictObject({
    action: z.literal('pause'),
    expectedRevision: revisionSchema,
  }),
  z.strictObject({
    action: z.literal('resume'),
    expectedRevision: revisionSchema,
  }),
  z.strictObject({
    action: z.literal('set_mode'),
    mode: z.enum(['manual', 'repository']),
    expectedRevision: revisionSchema,
  }),
])
export type AuthorRequest = z.infer<typeof authorRequestSchema>

export function commandOf(request: AuthorRequest): AuthorCommand {
  switch (request.action) {
    case 'publish':
      return { kind: 'publish', deploymentId: request.deploymentId }
    case 'set_mode':
      return { kind: 'set_mode', mode: request.mode }
    default:
      return { kind: request.action }
  }
}

const statusOf = {
  applied: 200,
  unchanged: 200,
  conflict: 409,
  not_paused: 409,
  not_publishable: 422,
} as const

const messageOf = {
  conflict: 'Publication changed; review the current state and retry',
  not_paused: 'Deck is not paused',
  not_publishable: 'Deployment is not a ready deployment of this deck',
} as const

function respond(result: Exclude<AuthorResult, { kind: 'not_found' }>) {
  const body =
    result.kind === 'applied' || result.kind === 'unchanged'
      ? { result: result.kind, publication: result.publication }
      : {
          error: messageOf[result.kind],
          code: result.kind,
          publication: result.publication,
        }
  return [body, statusOf[result.kind]] as const
}

const now = () => Math.floor(Date.now() / 1000)

/** Owner-only JSON API for a deck's publication. */
export const publicationApi = new Hono<{
  Bindings: Env
  Variables: { owner: Owner }
}>()

publicationApi.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  await next()
})

publicationApi.get('/:deck/publication', requireOwner, async (c) => {
  const deck = deckIdSchema.safeParse(c.req.param('deck'))
  const publication =
    deck.success &&
    (await readPublication(c.env.DB, deck.data, c.get('owner').userId))
  if (!publication) return c.json({ error: 'Deck not found' }, 404)
  return c.json({ publication })
})

publicationApi.post('/:deck/publication', csrf(), requireOwner, async (c) => {
  const deck = deckIdSchema.safeParse(c.req.param('deck'))
  if (!deck.success) return c.json({ error: 'Deck not found' }, 404)
  const body = authorRequestSchema.safeParse(
    await c.req.json().catch(() => null),
  )
  if (!body.success)
    return c.json({ error: 'Invalid publication request' }, 400)
  const result = await applyAuthorCommand(c.env.DB, {
    deckId: deck.data,
    ownerUserId: c.get('owner').userId,
    command: commandOf(body.data),
    expectedRevision: body.data.expectedRevision,
    now: now(),
  })
  if (result.kind === 'not_found')
    return c.json({ error: 'Deck not found' }, 404)
  const [payload, status] = respond(result)
  return c.json(payload, status)
})

/** The form version of an author request; browsers send strings. */
const formRequestSchema = z.preprocess((input) => {
  if (typeof input !== 'object' || input === null) return input
  const { expectedRevision, ...rest } = input as Record<string, unknown>
  return {
    ...rest,
    expectedRevision:
      typeof expectedRevision === 'string' && /^\d+$/.test(expectedRevision)
        ? Number(expectedRevision)
        : expectedRevision,
  }
}, authorRequestSchema)

/** Management-page forms for a deck's publication. */
export const publicationForms = new Hono<{
  Bindings: Env
  Variables: { owner: Owner }
}>()

publicationForms.post('/:deck/publication', csrf(), requireOwner, async (c) => {
  const deck = deckIdSchema.safeParse(c.req.param('deck'))
  if (!deck.success) return c.text('Deck not found', 404)
  const back = (result: string) =>
    c.redirect(`/decks/${deck.data}?result=${result}`, 303)
  const body = formRequestSchema.safeParse(await c.req.parseBody())
  if (!body.success) return back('invalid')
  const result = await applyAuthorCommand(c.env.DB, {
    deckId: deck.data,
    ownerUserId: c.get('owner').userId,
    command: commandOf(body.data),
    expectedRevision: body.data.expectedRevision,
    now: now(),
  })
  if (result.kind === 'not_found') return c.text('Deck not found', 404)
  return back(result.kind)
})
