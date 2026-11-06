import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { z } from 'zod'
import { requireOwner, type Owner } from '../auth/owner-session'
import { deckIdSchema } from '../decks/binding'
import { deploymentOrigin, parseContentBase } from './origin'
import { launchPage, PREVIEW_COOKIE, privateHeaders, reopenPage } from './pages'
import { consumeLaunch, issueLaunch } from './store'

const now = () => Math.floor(Date.now() / 1000)

/** Management-origin form that opens a deployment for its owner only. */
export const previewForms = new Hono<{
  Bindings: Env
  Variables: { owner: Owner }
}>()

previewForms.post(
  '/:deck/deployments/:id/preview',
  csrf(),
  requireOwner,
  async (c) => {
    for (const [name, value] of Object.entries(privateHeaders))
      c.header(name, value)
    let base: URL | null = null
    try {
      base = parseContentBase(c.env.CONTENT_ORIGIN, c.env.PUBLIC_ORIGIN)
    } catch {
      // The setting is reported where requests are routed.
    }
    if (!base) return c.text('Owner preview is not configured', 503)
    const deck = deckIdSchema.safeParse(c.req.param('deck'))
    const id = z.uuid().safeParse(c.req.param('id'))
    const token =
      deck.success &&
      id.success &&
      (await issueLaunch(c.env.DB, {
        deckId: deck.data,
        deploymentId: id.data,
        ownerUserId: c.get('owner').userId,
        now: now(),
      }))
    if (!token || !id.success) return c.text('No ready deployment to open', 404)
    const origin = deploymentOrigin(base, id.data)
    const nonce = crypto.randomUUID()
    c.header(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; form-action ${origin}; base-uri 'none'; frame-ancestors 'none'`,
    )
    return c.html(launchPage(`${origin}/_preview/launch`, token, nonce))
  },
)
