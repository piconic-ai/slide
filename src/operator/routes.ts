import { Hono, type Context, type MiddlewareHandler } from 'hono'
import type { JWTVerifyGetKey } from 'jose'
import { addInvite, listInvites, removeInvite } from '../auth/invites-store'
import { deckIdSchema } from '../decks/deck-id'
import { normalizeAddress } from '../mail/address'
import { applySuspensionCommand } from '../publication/suspension-store'
import { applyOperatorCommand } from '../publication/takedown-store'
import { listReportedDecks } from '../reports/store'
import { siteHeaders } from '../site/middleware'
import { ACCESS_TOKEN_HEADER, verifyAccessToken, type Operator } from './access'
import { accessKeys } from './access-client'
import { parseOperatorConfig, type OperatorConfig } from './config'
import {
  OPERATOR_PAGE_POLICY,
  operatorHome,
  parseOperatorResult,
  type OperatorResultMessage,
} from './pages'
import {
  findAccount,
  findDeck,
  listHiddenDecks,
  listSuspendedAccounts,
  parsePage,
} from './store'
import { parseSuspensionTarget } from './suspension-target'
import { parseTakedownTarget } from './target'

/** The operator host's settings; null when none is configured. */
export function operatorConfigOf(env: Env): OperatorConfig | null {
  const config = readOperatorConfig(env)
  // A set but unusable origin leaves no host to close, so it must be loud:
  // the host named in the Worker's routes would be answered by another app.
  if (!config && env.OPERATOR_ORIGIN)
    console.error(JSON.stringify({ event: 'operator_origin_invalid' }))
  return config
}

function readOperatorConfig(env: Env): OperatorConfig | null {
  return parseOperatorConfig({
    origin: env.OPERATOR_ORIGIN,
    teamDomain: env.ACCESS_TEAM_DOMAIN,
    audience: env.ACCESS_AUD,
    publicOrigin: env.PUBLIC_ORIGIN,
    contentOrigin: env.CONTENT_ORIGIN,
  })
}

export const OPERATOR_ROBOTS_TXT = 'User-agent: *\nDisallow: /\n'

const now = () => Math.floor(Date.now() / 1000)

const hideMessage = {
  applied: 'hidden',
  unchanged: 'unchanged',
  invalid_reason: 'invalid_reason',
  // The email came from a verified token, so this is not the operator's to fix.
  invalid_operator: 'not_found',
  not_found: 'not_found',
} as const
const releaseMessage = { ...hideMessage, applied: 'released' } as const
const suspendMessage = { ...hideMessage, applied: 'suspended' } as const
const suspensionReleaseMessage = {
  ...hideMessage,
  applied: 'suspension_released',
} as const

type OperatorEnv = { Bindings: Env; Variables: { operator: Operator } }

async function suspendAccount(c: Context<OperatorEnv>) {
  const form = await c.req.parseBody()
  const handle =
    typeof form.target === 'string'
      ? parseSuspensionTarget(form.target, c.env.PUBLIC_ORIGIN)
      : null
  if (!handle) return c.redirect('/?result=invalid_target', 303)
  const userId = await findAccount(c.env.DB, handle)
  if (!userId) return c.redirect('/?result=not_found', 303)
  const result = await applySuspensionCommand(c.env.DB, {
    userId,
    command: {
      kind: 'suspend',
      reason: typeof form.reason === 'string' ? form.reason : '',
      operator: c.get('operator').email,
    },
    now: now(),
  })
  return c.redirect(`/?result=${suspendMessage[result.kind]}`, 303)
}

async function releaseSuspension(
  c: Context<OperatorEnv, '/suspensions/:user/release'>,
) {
  const userId = c.req.param('user')
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId))
    return c.redirect('/?result=not_found', 303)
  const result = await applySuspensionCommand(c.env.DB, {
    userId,
    command: { kind: 'release' },
    now: now(),
  })
  return c.redirect(`/?result=${suspensionReleaseMessage[result.kind]}`, 303)
}

/**
 * The app that answers on the operator host and nowhere else. Cloudflare
 * Access stands in front of the host, and every request is verified again
 * here, so a request that reached the Worker by another path is answered
 * exactly like a missing page.
 */
export function operatorApp(
  config: OperatorConfig,
  keysOf: (issuer: string) => JWTVerifyGetKey = accessKeys,
) {
  const app = new Hono<OperatorEnv>()
  // This runs outside the baseline headers, so what it sets is not
  // overwritten by them.
  app.use(async (c, next) => {
    await next()
    // Nothing here may be listed by a search engine or kept by a cache.
    c.res.headers.set('X-Robots-Tag', 'noindex, nofollow')
    c.res.headers.set('Cache-Control', 'no-store')
    // The baseline policy sends no referrer at all, and a browser then
    // posts a form with `Origin: null`, which the origin check below would
    // refuse. Within this origin the origin is sent. Nothing leaves it.
    c.res.headers.set('Referrer-Policy', 'same-origin')
  })
  app.use(siteHeaders)
  app.notFound((c) => c.text('Not found', 404))
  app.onError((error, c) => {
    console.error(JSON.stringify({ event: 'operator_error', name: error.name }))
    return c.text('Internal error', 500)
  })
  app.get('/robots.txt', (c) => c.text(OPERATOR_ROBOTS_TXT))
  app.use(async (c, next) => {
    if (!config.access) return c.notFound()
    const result = await verifyAccessToken(
      c.req.header(ACCESS_TOKEN_HEADER),
      config.access,
      keysOf(config.access.issuer),
      now(),
    )
    if (result.kind === 'denied') {
      console.warn(
        JSON.stringify({
          event: 'operator_access_denied',
          reason: result.reason,
        }),
      )
      return c.notFound()
    }
    c.set('operator', result.operator)
    await next()
  })
  app.get('/', async (c) =>
    c.html(
      operatorHome({
        operator: c.get('operator'),
        reported: await listReportedDecks(c.env.DB),
        suspended: await listSuspendedAccounts(c.env.DB),
        invites: await listInvites(c.env.DB),
        ...(await listHiddenDecks(c.env.DB, parsePage(c.req.query('page')))),
        result: parseOperatorResult(c.req.query('result')),
      }),
      200,
      { 'Content-Security-Policy': OPERATOR_PAGE_POLICY },
    ),
  )
  const done = (result: OperatorResultMessage) => `/?result=${result}`
  // A request that changes anything must say it comes from this origin,
  // whatever its content type and whatever else it claims about itself.
  const sameOrigin: MiddlewareHandler<OperatorEnv> = async (c, next) => {
    if (c.req.header('Origin') !== config.origin)
      return c.text('Forbidden', 403)
    await next()
  }
  app.post('/takedowns', sameOrigin, async (c) => {
    const form = await c.req.parseBody()
    const target =
      typeof form.target === 'string'
        ? parseTakedownTarget(form.target, c.env.PUBLIC_ORIGIN)
        : null
    if (!target) return c.redirect(done('invalid_target'), 303)
    const deckId = await findDeck(c.env.DB, target)
    if (!deckId) return c.redirect(done('not_found'), 303)
    const result = await applyOperatorCommand(c.env.DB, {
      deckId,
      command: {
        kind: 'hide',
        reason: typeof form.reason === 'string' ? form.reason : '',
        operator: c.get('operator').email,
      },
      now: now(),
    })
    return c.redirect(done(hideMessage[result.kind]), 303)
  })
  app.post('/takedowns/:deck/release', sameOrigin, async (c) => {
    const deck = deckIdSchema.safeParse(c.req.param('deck'))
    if (!deck.success) return c.redirect(done('not_found'), 303)
    const result = await applyOperatorCommand(c.env.DB, {
      deckId: deck.data,
      command: { kind: 'release' },
      now: now(),
    })
    return c.redirect(done(releaseMessage[result.kind]), 303)
  })
  app.post('/invites', sameOrigin, async (c) => {
    const form = await c.req.parseBody()
    const email = normalizeAddress(form.email)
    if (!email) return c.redirect(done('invalid_email'), 303)
    await addInvite(c.env.DB, {
      email,
      invitedBy: c.get('operator').email,
      now: now(),
    })
    return c.redirect(done('invited'), 303)
  })
  // The address travels in the body, not the path, so no log keeps it.
  app.post('/invites/remove', sameOrigin, async (c) => {
    const form = await c.req.parseBody()
    const email = normalizeAddress(form.email)
    if (!email) return c.redirect(done('invalid_email'), 303)
    await removeInvite(c.env.DB, email)
    return c.redirect(done('invite_removed'), 303)
  })
  app.post('/suspensions', sameOrigin, suspendAccount)
  app.post('/suspensions/:user/release', sameOrigin, releaseSuspension)
  return app
}
