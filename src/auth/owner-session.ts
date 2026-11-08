import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie } from 'hono/cookie'
import { authAccount } from '../db/auth-schema'
import { base64Url } from './github-oauth'
import { createAuth, OWNER_COOKIE } from './config'
export { OWNER_COOKIE, OWNER_SESSION_SECONDS } from './config'

export type Owner = Readonly<{ userId: string; login: string }>
type OwnerEnv = { Bindings: Env; Variables: { owner: Owner } }

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
  if (!account || account.githubId !== c.env.GITHUB_ACTOR_ID) return null
  return {
    id: session.session.id,
    owner: { userId: account.githubId, login: session.user.name },
  }
}
export async function currentOwner<E extends { Bindings: Env }>(
  c: Context<E>,
): Promise<Owner | null> {
  return (await ownerSession(c))?.owner ?? null
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
export const requireOwner: MiddlewareHandler<OwnerEnv> = async (c, next) => {
  const owner = await currentOwner(c)
  if (!owner) return c.json({ error: 'Sign in as the owner' }, 401)
  c.set('owner', owner)
  await next()
}
