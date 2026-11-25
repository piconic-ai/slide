import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import { deleteCookie } from 'hono/cookie'
import { authSession, authUser } from '../db/auth-schema'
import { invitedUserIds } from '../db/invitation-schema'
import { accounts } from '../db/schema'
import { OWNER_COOKIE, createAuth } from './config'
export { OWNER_COOKIE, OWNER_SESSION_SECONDS } from './config'

/** `login` is the person's handle, the name in their share URLs. */
export type Owner = Readonly<{ userId: string; login: string }>

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

export async function hashToken(token: string): Promise<string> {
  return base64Url(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
    ),
  )
}
export function randomToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)))
}

/**
 * Who a request is. `uninvited` is someone who signed in and was taken off
 * the invitations since; their sessions are ended when this is first read.
 * `needs_welcome` is signed in and invited but has no handle yet.
 */
export type SignInState =
  | Readonly<{ kind: 'signed_out' }>
  | Readonly<{ kind: 'uninvited' }>
  | Readonly<{ kind: 'needs_welcome'; userId: string }>
  | Readonly<{ kind: 'owner'; id: string; owner: Owner }>

const states = new WeakMap<Request, Promise<SignInState>>()

async function readState<E extends { Bindings: Env }>(
  c: Context<E>,
): Promise<SignInState> {
  const auth = createAuth(c.env)
  if (!auth) return { kind: 'signed_out' }
  const { headers, response: session } = await auth.api.getSession({
    headers: c.req.raw.headers,
    returnHeaders: true,
  })
  // A renewed session comes with a cookie that lasts as long (F28-AC103).
  for (const cookie of headers.getSetCookie())
    c.header('Set-Cookie', cookie, { append: true })
  if (!session) return { kind: 'signed_out' }
  const db = drizzle(c.env.DB)
  const userId = session.user.id
  const invited = await invitedUserIds(db).where(eq(authUser.id, userId)).get()
  if (!invited) {
    // Taken off the invitations: the sign-in ends with the next request.
    await db.delete(authSession).where(eq(authSession.userId, userId))
    return { kind: 'uninvited' }
  }
  const account = await db
    .select({ handle: accounts.handle })
    .from(accounts)
    .where(eq(accounts.user_id, userId))
    .get()
  if (!account) return { kind: 'needs_welcome', userId }
  return {
    kind: 'owner',
    id: session.session.id,
    owner: { userId, login: account.handle },
  }
}

/** The request's sign-in state, read once per request. */
export function signInState<E extends { Bindings: Env }>(
  c: Context<E>,
): Promise<SignInState> {
  const known = states.get(c.req.raw)
  if (known) return known
  const state = readState(c)
  states.set(c.req.raw, state)
  return state
}

export async function ownerSession<E extends { Bindings: Env }>(c: Context<E>) {
  const state = await signInState(c)
  return state.kind === 'owner' ? { id: state.id, owner: state.owner } : null
}
/**
 * Whether the request carries a live sign-in at all, whoever it is. With no
 * owner session, this tells someone who signed in and was then taken off
 * the invitations from someone who is signed out.
 */
export async function hasSignIn<E extends { Bindings: Env }>(
  c: Context<E>,
): Promise<boolean> {
  const state = await signInState(c)
  return state.kind !== 'signed_out'
}
export async function endOwnerSession<E extends { Bindings: Env }>(
  c: Context<E>,
) {
  const auth = createAuth(c.env)
  if (auth) {
    const response = await auth.api.signOut({
      headers: c.req.raw.headers,
      asResponse: true,
    })
    for (const cookie of response.headers.getSetCookie())
      c.header('Set-Cookie', cookie, { append: true })
  }
  deleteCookie(c, OWNER_COOKIE, { path: '/', secure: true })
}
