import type { Context, MiddlewareHandler } from 'hono'
import { setCookie } from 'hono/cookie'
import { verifyAccessToken, ACCESS_TOKEN_HEADER } from '../operator/access'
import { accessKeys } from '../operator/access-client'
import type { OperatorConfig } from '../operator/config'
import {
  maintenanceResponse,
  plainHeldResponse,
} from './maintenance-middleware'
import { PASS_COOKIE } from './pass-routes'
import {
  PASS_LIFETIME_SECONDS,
  signPass,
  usableSecret,
  verifyPass,
} from './pass-token'
import { parseSwitch, type MaintenanceSwitch } from './switch'

import { ENTER_PATH, ENTRANCE_PATH } from './entrance-path'

export { ENTER_PATH, ENTRANCE_PATH }

const nowSeconds = () => Math.floor(Date.now() / 1000)

/** Whether a request is for the entrance of the operator host. */
export const isEntranceRequest = (request: Request) =>
  request.method === 'GET' && new URL(request.url).pathname === ENTRANCE_PATH

const log = (result: string, reason?: string) =>
  // Never an address, a token or a name: what happened, and a reason's code.
  console.log(
    JSON.stringify({
      event: 'maintenance_entrance',
      result,
      ...(reason ? { reason } : {}),
    }),
  )

/**
 * The entrance (F38-AC19): while maintenance holds the service, an operator
 * who has passed Cloudflare Access is sent on to the management host with a
 * value that lasts a minute. Access is verified here, as every operator page
 * does, and not taken from the request's say-so. Anyone else, and anything
 * that cannot be made, is answered with the 503 that every other address
 * gets, so that the entrance does not tell what it is. The target is built from
 * the service's own settings, never from the request.
 */
export async function operatorEntrance(
  request: Request,
  env: Env,
  config: OperatorConfig,
  held: Extract<MaintenanceSwitch, { kind: 'on' }>,
  keysOf = accessKeys,
): Promise<Response> {
  const now = nowSeconds()
  const refuse = (reason: string) => {
    log('refused', reason)
    return plainHeldResponse(held, now)
  }
  if (!config.access) return refuse('closed')
  const secret = env.BETTER_AUTH_SECRET
  if (!usableSecret(secret) || env.MAINTENANCE === undefined)
    return refuse('no_key')
  const access = await verifyAccessToken(
    request.headers.get(ACCESS_TOKEN_HEADER) ?? undefined,
    config.access,
    keysOf(config.access.issuer),
    now,
  )
  if (access.kind === 'denied') return refuse(access.reason)
  const { value } = await signPass(secret, 'enter', env.MAINTENANCE, now)
  log('issued')
  const target = new URL(ENTER_PATH, env.PUBLIC_ORIGIN)
  target.searchParams.set('t', value)
  return new Response(null, {
    status: 303,
    headers: {
      Location: target.toString(),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}

/**
 * The management host's side of the entrance (F38-AC19, AC20): takes the
 * value the entrance made, and gives the browser a pass that lasts an hour,
 * then sends it to the top page, so that the value does not stay in the address
 * bar. Only while maintenance holds the service; otherwise it does nothing and
 * the address is no page, like any other that is not there. A value that is
 * not good, for whatever reason, is answered with the 503 of maintenance.
 */
export const acceptEntrance: MiddlewareHandler<{ Bindings: Env }> = async (
  c,
  next,
) => {
  const held = parseSwitch(c.env.MAINTENANCE)
  if (held.kind === 'off' || c.req.method !== 'GET') return next()
  const now = nowSeconds()
  const secret = c.env.BETTER_AUTH_SECRET
  const heldValue = c.env.MAINTENANCE
  if (
    !usableSecret(secret) ||
    heldValue === undefined ||
    !(await verifyPass(secret, c.req.query('t'), 'enter', heldValue, now))
  ) {
    log('not_accepted')
    return maintenanceResponse(c, held, now)
  }
  const pass = await signPass(secret, 'pass', heldValue, now)
  return grant(c, pass.value)
}

function grant(c: Context<{ Bindings: Env }>, pass: string) {
  setCookie(c, PASS_COOKIE, pass, {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: PASS_LIFETIME_SECONDS,
  })
  log('accepted')
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  return c.redirect('/', 303)
}
