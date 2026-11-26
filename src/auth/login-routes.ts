import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { csrf } from 'hono/csrf'
import { authVerification } from '../db/auth-schema'
import { loginCodeMail } from '../mail/login-code-mail'
import { normalizeAddress } from '../mail/address'
import { mailerOf } from '../mail/mailer-routes'
import { reportLoginMailFailure } from '../alerts/login-mail-routes'
import { INTENDED_503_HEADER } from '../alerts/response-log'
import { deleteCookie } from 'hono/cookie'
import { leaveBeforeSignup } from './signup-store'
import { checkDisplayName } from './display-name'
import { checkHandle } from './handle-rules'
import { createAccount } from './accounts-store'
import { handleAvailability } from '../handles/store'
import { createAuth, authSecret } from './auth-store'
import { OWNER_COOKIE } from './config'
import { addInvite, isInvited } from './invites-store'
import { isRegistered } from './registered-store'
import { readSignupPause } from './signup-pause-store'
import {
  admitsSignIn,
  OPEN_SIGNUP_INVITER,
  signupModeOf,
  type Standing,
} from './signup-mode'
import { landingOf } from './landing'
import {
  codePage,
  loginPage,
  loginQuery,
  loginPolicy,
  welcomePage,
  type Carry,
} from './login-pages'
import { CODE_ATTEMPTS, decideSend, parseLoginCodeLimits } from './login-policy'
import { readRequests, tryRecordRequest } from './login-request-store'
import {
  reportMailFlood,
  reportSignupSurge,
} from '../alerts/signup-alert-routes'
import { signInState } from './owner-session'
import { verifyTurnstile } from './turnstile-client'
import { loginKeys } from './login-keys'
import { langOf } from '../site/lang'
import type { Lang } from '../site/i18n'
import { dayTimeFormats } from '../share/dates'
import { recordFrom } from '../metrics/record-routes'

type C = Context<{ Bindings: Env }>

const now = () => Math.floor(Date.now() / 1000)

export const loginRoutes = new Hono<{ Bindings: Env }>()
const noStore: MiddlewareHandler = async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
}
for (const path of ['/login', '/login/code', '/welcome', '/welcome/leave'])
  loginRoutes.use(path, noStore)

/** Where a sign-in goes on from `to` and `drop`, which anyone can write. */
const carryOf = (fields: Readonly<Record<string, unknown>>): Carry => {
  const to = typeof fields.to === 'string' ? fields.to : undefined
  const drop = typeof fields.drop === 'string' ? fields.drop : undefined
  return {
    ...(to ? { to: to.slice(0, 300) } : {}),
    ...(drop ? { drop: drop.slice(0, 64) } : {}),
  }
}

const html = (c: C, body: string | Promise<string>, status = 200) =>
  Promise.resolve(body).then((page) =>
    c.html(page, status as 200, {
      'Content-Security-Policy': loginPolicy(Boolean(c.env.TURNSTILE_SITE_KEY)),
    }),
  )

const waitUntilOf = (c: C) => {
  try {
    const context = c.executionCtx
    return (promise: Promise<unknown>) => context.waitUntil(promise)
  } catch {
    // No execution context (tests, local tooling): the work is awaited.
    return undefined
  }
}

loginRoutes.get('/login', async (c) => {
  const state = await signInState(c)
  const carry = carryOf(c.req.query())
  if (state.kind === 'owner')
    return c.redirect(landingOf(carry.to, carry.drop), 303)
  if (state.kind === 'needs_welcome')
    return c.redirect(`/welcome${loginQuery(carry)}`, 303)
  return html(
    c,
    String(
      await loginPage(langOf(c), new URL(c.req.url), {
        carry,
        mode: signupModeOf(c.env.OPEN_SIGNUP),
        paused: (await readSignupPause(c.env.DB)).kind === 'paused',
        siteKey: c.env.TURNSTILE_SITE_KEY,
      }),
    ),
  )
})

/**
 * Turnstile is all or nothing: a secret without a site key (or the other way
 * round) is a mistake, and so is a real mail service without it. The check
 * is skipped only where neither is set and no real mail goes out.
 */
function turnstileReady(env: Env): boolean {
  const both = Boolean(env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY)
  const neither = !env.TURNSTILE_SECRET && !env.TURNSTILE_SITE_KEY
  const realMail = Boolean(
    env.MAIL_API_TOKEN && env.MAIL_ACCOUNT_ID && env.MAIL_FROM,
  )
  return both || (neither && !realMail)
}

/** Runs work that need not delay the answer after it where the platform allows, else before it. */
const later = (c: C, work: Promise<unknown>) => {
  const wait = waitUntilOf(c)
  return wait ? void wait(work) : work
}

/**
 * What is known of an address: both questions are always asked, so the work
 * does not depend on the answers.
 */
async function standingOf(env: Env, address: string): Promise<Standing> {
  const [invited, registered] = await Promise.all([
    isInvited(env.DB, address),
    isRegistered(env.DB, address),
  ])
  return { invited, registered }
}

const timeOf = (seconds: number, lang: Lang) =>
  dayTimeFormats[lang].format(seconds * 1000)

/**
 * Asks for a code. The answer is the same page whether or not the address
 * is invited (F28-AC7), and the work that differs, the mail itself, runs
 * after the answer where the platform allows (F28-AC9).
 */
loginRoutes.post('/login', csrf(), async (c) => {
  const lang = langOf(c)
  const url = new URL(c.req.url)
  const form = await c.req.parseBody()
  const carry = carryOf(form)
  const typed = typeof form.email === 'string' ? form.email : ''
  const email = normalizeAddress(typed)
  const mode = signupModeOf(c.env.OPEN_SIGNUP)
  // Read before anything else is answered, so that every answer of this
  // request says the same to everyone (F42-AC14).
  const paused = (await readSignupPause(c.env.DB)).kind === 'paused'
  const again = (
    problem: Parameters<typeof loginPage>[2]['problem'],
    status: number,
  ) =>
    html(
      c,
      String(
        loginPage(lang, url, {
          carry,
          email: typed.slice(0, 254),
          problem,
          mode,
          paused,
          siteKey: c.env.TURNSTILE_SITE_KEY,
        }),
      ),
      status,
    )
  if (!email) return again({ kind: 'invalid_email' }, 400)
  const secret = authSecret(c.env)
  const mailer = mailerOf(c.env)
  if (!secret || !mailer || !turnstileReady(c.env)) {
    // Login not being set up is an answer the service means to give, not a
    // fault the 5xx alert should count.
    c.header(INTENDED_503_HEADER, 'not_configured')
    return again({ kind: 'not_configured' }, 503)
  }
  const ip = c.req.header('CF-Connecting-IP') ?? null
  if (c.env.TURNSTILE_SECRET) {
    const token = String(form['cf-turnstile-response'] ?? '')
    if (!(await verifyTurnstile(c.env.TURNSTILE_SECRET, token, ip)))
      return again({ kind: 'bot_failed' }, 400)
  }
  const limits = parseLoginCodeLimits(c.env.LOGIN_CODE_LIMITS)
  const at = now()
  const keys = await loginKeys(secret, email, ip)
  // Counting and recording are one statement, so requests that arrive
  // together cannot all pass a limit that only one of them fits under.
  const recorded = await tryRecordRequest(c.env.DB, {
    kind: 'send',
    keys,
    now: at,
    windowSeconds: limits.windowSeconds,
    perAddress: limits.perAddress,
    perSource: limits.perSource,
    perTotal: limits.total,
  })
  // At 80% of the total cap, and at the cap, the operator is told (F42-AC8).
  await later(c, reportMailFlood(c.env))
  if (!recorded) {
    const decision = decideSend(
      limits,
      at,
      await readRequests(
        c.env.DB,
        'send',
        keys,
        at - limits.windowSeconds,
        limits.total,
      ),
    )
    const retryAt = decision.kind === 'limited' ? decision.retryAt : at + 60
    c.header('Retry-After', String(Math.max(1, retryAt - at)))
    // The total cap speaks the same way to everyone, whatever address was
    // typed: it says nothing of who is registered (F42-AC7).
    return decision.kind === 'limited' && decision.scope === 'total'
      ? again({ kind: 'busy' }, 429)
      : again({ kind: 'limited', retryAt: timeOf(retryAt, lang) }, 429)
  }
  const auth = createAuth(c.env, {
    waitUntil: waitUntilOf(c),
    async onCode(to, code) {
      try {
        // The same work for every address; only one that is admitted is
        // mailed: an invited one, or any one while sign-up is open, and,
        // while new sign-ups are stopped, only a registered one.
        const standing = await standingOf(c.env, to)
        if (admitsSignIn({ mode, paused }, standing)) {
          await mailer(loginCodeMail(to, code, lang))
          recordFrom(c, { name: 'login_code_sent' })
        }
      } catch (error) {
        console.error(
          JSON.stringify({
            event: 'login_code_unsent',
            name: error instanceof Error ? error.name : 'unknown',
          }),
        )
        // Enough of these within the hour is told to the operator (F39-AC1).
        await reportLoginMailFailure(c.env)
      }
    },
  })
  await auth?.api.sendVerificationOTP({ body: { email, type: 'sign-in' } })
  return html(
    c,
    String(
      codePage(lang, url, {
        carry,
        email,
        paused,
        siteKey: c.env.TURNSTILE_SITE_KEY,
      }),
    ),
  )
})

const verificationKey = (email: string) => `sign-in-otp-${email}`

/** How many wrong tries the code at this address has left, if it still lives. */
async function triesLeft(database: D1Database, email: string) {
  const row = await drizzle(database)
    .select({ value: authVerification.value })
    .from(authVerification)
    .where(eq(authVerification.identifier, verificationKey(email)))
    .get()
  if (!row) return null
  const used = Number(row.value.slice(row.value.lastIndexOf(':') + 1))
  return Number.isInteger(used) ? Math.max(0, CODE_ATTEMPTS - used) : null
}

loginRoutes.post('/login/code', csrf(), async (c) => {
  const lang = langOf(c)
  const url = new URL(c.req.url)
  const form = await c.req.parseBody()
  const carry = carryOf(form)
  const email = normalizeAddress(form.email)
  const code = String(form.code ?? '').trim()
  const auth = createAuth(c.env)
  if (!email || !auth) return c.redirect(`/login${loginQuery(carry)}`, 303)
  const paused = (await readSignupPause(c.env.DB)).kind === 'paused'
  const retry = async (status: number) => {
    recordFrom(c, { name: 'login_code_entered', outcome: 'rejected' })
    // No code left to try (used up, expired, or never asked for) reads the
    // same for every address.
    const left = await triesLeft(c.env.DB, email)
    const problem =
      left === null || left === 0
        ? ({ kind: 'dead' } as const)
        : ({ kind: 'wrong', left } as const)
    return html(
      c,
      String(
        codePage(lang, url, {
          carry,
          email,
          problem,
          paused,
          siteKey: c.env.TURNSTILE_SITE_KEY,
        }),
      ),
      status,
    )
  }
  const limits = parseLoginCodeLimits(c.env.LOGIN_CODE_LIMITS)
  const secret = authSecret(c.env)
  const at = now()
  // Tries at entering a code are counted per address, right or wrong, so no
  // one can keep guessing across fresh codes (each code takes only 5).
  if (
    !secret ||
    !(await tryRecordRequest(c.env.DB, {
      kind: 'attempt',
      keys: await loginKeys(secret, email, null),
      now: at,
      windowSeconds: limits.windowSeconds,
      perAddress: limits.attemptsPerAddress,
      perSource: null,
      perTotal: null,
    }))
  )
    return retry(429)
  // The code is checked for every address alike, without signing anyone in:
  // an address that is not invited has a code no one received and fails the
  // same way, and one that was taken off the invitations since never gets a
  // user or a session row, even with the right code.
  const checked = await auth.api.checkVerificationOTP({
    body: { email, otp: code, type: 'sign-in' },
    asResponse: true,
  })
  // Better Auth checks the code first, and then says whether the user exists.
  // A first-time person has no user yet, which is not a wrong code.
  const rightCode =
    checked.ok ||
    ((await checked.json().catch(() => null)) as { code?: string } | null)
      ?.code === 'USER_NOT_FOUND'
  if (!rightCode) return retry(400)
  const standing = await standingOf(c.env, email)
  const { invited } = standing
  if (
    !admitsSignIn({ mode: signupModeOf(c.env.OPEN_SIGNUP), paused }, standing)
  )
    return retry(400)
  const response = await auth.api.signInEmailOTP({
    body: { email, otp: code },
    // Only the agent, which the session turns into the device's name.
    headers: new Headers({ 'user-agent': c.req.header('user-agent') ?? '' }),
    asResponse: true,
  })
  if (!response.ok) return retry(400)
  // Signing up while sign-up is open: the person joins the invitation list,
  // under the service's own name, so that every later check of "may this
  // person act" is the one it always was, and so that they stay when sign-up
  // is closed again (F42-AC4). It goes with the address's user row.
  if (!invited)
    await addInvite(c.env.DB, {
      email,
      invitedBy: OPEN_SIGNUP_INVITER,
      now: at,
    })
  for (const cookie of response.headers.getSetCookie())
    c.header('Set-Cookie', cookie, { append: true })
  recordFrom(c, { name: 'login_code_entered', outcome: 'accepted' })
  // The welcome page sends someone who already has a handle on at once.
  return c.redirect(`/welcome${loginQuery(carry)}`, 303)
})

loginRoutes.get('/welcome', async (c) => {
  const state = await signInState(c)
  const carry = carryOf(c.req.query())
  if (state.kind === 'owner')
    return c.redirect(landingOf(carry.to, carry.drop), 303)
  if (state.kind !== 'needs_welcome')
    return c.redirect(`/login${loginQuery(carry)}`, 303)
  // Someone who signed in before new sign-ups were stopped is told so here.
  const paused = (await readSignupPause(c.env.DB)).kind === 'paused'
  return html(
    c,
    String(
      await welcomePage(langOf(c), new URL(c.req.url), {
        carry,
        ...(paused ? { problem: { paused: true as const } } : {}),
      }),
    ),
  )
})

loginRoutes.post('/welcome', csrf(), async (c) => {
  const state = await signInState(c)
  const form = await c.req.parseBody()
  const carry = carryOf(form)
  if (state.kind === 'owner')
    return c.redirect(landingOf(carry.to, carry.drop), 303)
  if (state.kind !== 'needs_welcome')
    return c.redirect(`/login${loginQuery(carry)}`, 303)
  const lang = langOf(c)
  const url = new URL(c.req.url)
  const handleText = typeof form.handle === 'string' ? form.handle.trim() : ''
  const typedName = typeof form.name === 'string' ? form.name : ''
  const name = checkDisplayName(form.name)
  const checked = checkHandle(handleText)
  // The box on the page is only a convenience: the service asks for the
  // agreement itself, and no account is made without it.
  const agreed = form.terms === 'on'
  const problem = {
    ...(agreed ? {} : { terms: true as const }),
    ...(checked.kind === 'refused' ? { handle: checked.reason } : {}),
    ...(name.kind === 'refused' ? { name: name.reason } : {}),
  }
  const show = (
    shown: Parameters<typeof welcomePage>[2]['problem'],
    status: number,
  ) =>
    html(
      c,
      String(
        welcomePage(lang, url, {
          carry,
          handle: handleText.slice(0, 80),
          displayName: typedName.slice(0, 200),
          problem: shown,
        }),
      ),
      status,
    )
  // An account is a new sign-up: while they are stopped, none is made, however
  // far the person got (F42-AC12). The answer is meant, not a fault.
  if ((await readSignupPause(c.env.DB)).kind === 'paused') {
    c.header(INTENDED_503_HEADER, 'signup_paused')
    return show({ paused: true }, 503)
  }
  if (!agreed || checked.kind !== 'valid' || name.kind !== 'valid')
    return show(problem, 400)
  const at = now()
  const availability = await handleAvailability(c.env.DB, checked.handle, at)
  if (availability !== 'available') return show({ handle: availability }, 409)
  const result = await createAccount(c.env.DB, {
    userId: state.userId,
    handle: checked.handle,
    displayName: name.name,
    now: at,
  })
  if (result === 'handle_taken') return show({ handle: 'taken' }, 409)
  if (result === 'handle_held') return show({ handle: 'held' }, 409)
  // They left, or were swept, while the form was open: nobody is signed in.
  if (result === 'no_user') return c.redirect(`/login${loginQuery(carry)}`, 303)
  // A surge of new sign-ups is told to the operator at once (F42-AC10).
  if (result === 'created') await later(c, reportSignupSurge(c.env))
  return c.redirect(landingOf(carry.to, carry.drop), 303)
})

/**
 * Leaving before signing up (F28-AC64): deletes what this person's sign-in
 * made (their address, their sessions, their code), takes the cookie off the
 * browser and goes to the top page. It acts only on the signed-in person
 * and only while they have no account; the operator's invitation stays.
 */
loginRoutes.post('/welcome/leave', csrf(), async (c) => {
  const state = await signInState(c)
  // Someone with an account has nothing to leave: their session and cookie
  // stay together, and they go where they were going.
  if (state.kind === 'owner') {
    const carry = carryOf(await c.req.parseBody())
    return c.redirect(landingOf(carry.to, carry.drop), 303)
  }
  if (state.kind === 'needs_welcome')
    await leaveBeforeSignup(c.env.DB, state.userId)
  deleteCookie(c, OWNER_COOKIE, { path: '/', secure: true })
  return c.redirect('/', 303)
})
