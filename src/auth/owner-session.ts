import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import { deleteCookie } from 'hono/cookie'
import { authAccount } from '../db/auth-schema'
import { isAuthor, parseAuthors } from './authors'
import { base64Url } from './github-oauth'
import { createAuth, OWNER_COOKIE } from './config'
export { OWNER_COOKIE, OWNER_SESSION_SECONDS } from './config'

export type Owner = Readonly<{ userId: string; login: string }>

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

export async function ownerSession<E extends { Bindings: Env }>(c: Context<E>) {
  const auth = createAuth(c.env)
  if (!auth) return null
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return null
  const account = await drizzle(c.env.DB)
    .select({ githubId: authAccount.accountId })
    .from(authAccount)
    .where(
      and(
        eq(authAccount.userId, session.user.id),
        eq(authAccount.providerId, 'github'),
      ),
    )
    .get()
  if (
    !account ||
    !isAuthor(parseAuthors(c.env.AUTHOR_GITHUB_IDS), account.githubId)
  )
    return null
  return {
    id: session.session.id,
    owner: { userId: account.githubId, login: session.user.name },
  }
}
/**
 * Whether the request carries a live sign-in at all, whoever it is. With no
 * owner session, this tells someone who signed in and was then taken off the
 * registration from someone who is signed out.
 */
export async function hasSignIn<E extends { Bindings: Env }>(
  c: Context<E>,
): Promise<boolean> {
  const auth = createAuth(c.env)
  if (!auth) return false
  return (await auth.api.getSession({ headers: c.req.raw.headers })) !== null
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
