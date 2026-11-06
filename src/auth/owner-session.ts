import { and, eq, gt, lte, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { ownerSessionRowSchema, ownerSessions } from '../db/schema'
import { base64Url } from './github-oauth'

export const OWNER_COOKIE = '__Host-slide_owner'
// Provisional lifetime of an owner browser session; adjust with use.
export const OWNER_SESSION_SECONDS = 12 * 60 * 60

export type Owner = Readonly<{ userId: string; login: string }>
type OwnerEnv = { Bindings: Env; Variables: { owner: Owner } }

const now = () => Math.floor(Date.now() / 1000)

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  )
  return base64Url(new Uint8Array(digest))
}

export function randomToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)))
}

/** Stores a new owner session and sets its host-only cookie. */
export async function startOwnerSession(
  c: Context<{ Bindings: Env }>,
  owner: Owner,
) {
  const token = randomToken()
  const created = now()
  const db = drizzle(c.env.DB)
  await db.batch([
    // A new login replaces the owner's other sessions, and expired rows are
    // removed opportunistically.
    db
      .delete(ownerSessions)
      .where(
        or(
          lte(ownerSessions.expires_at, created),
          eq(ownerSessions.github_user_id, owner.userId),
        ),
      ),
    db.insert(ownerSessions).values({
      token_hash: await hashToken(token),
      github_user_id: owner.userId,
      github_login: owner.login,
      created_at: created,
      expires_at: created + OWNER_SESSION_SECONDS,
    }),
  ])
  setCookie(c, OWNER_COOKIE, token, {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: OWNER_SESSION_SECONDS,
  })
}

/** Returns the signed-in owner, rechecking the configured allowlist. */
export async function currentOwner<E extends { Bindings: Env }>(
  c: Context<E>,
): Promise<Owner | null> {
  const token = getCookie(c, OWNER_COOKIE)
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null
  const row = await drizzle(c.env.DB)
    .select()
    .from(ownerSessions)
    .where(
      and(
        eq(ownerSessions.token_hash, await hashToken(token)),
        gt(ownerSessions.expires_at, now()),
      ),
    )
    .get()
    .then((result) => ownerSessionRowSchema.optional().parse(result))
  if (!row || row.github_user_id !== c.env.GITHUB_ACTOR_ID) return null
  return { userId: row.github_user_id, login: row.github_login }
}

export async function endOwnerSession(c: Context<{ Bindings: Env }>) {
  const token = getCookie(c, OWNER_COOKIE)
  if (token)
    await drizzle(c.env.DB)
      .delete(ownerSessions)
      .where(eq(ownerSessions.token_hash, await hashToken(token)))
      .run()
  deleteCookie(c, OWNER_COOKIE, { path: '/', secure: true })
}

/**
 * Rejects requests without a valid owner session. SameSite=Lax does not stop
 * same-site requests, so state-changing routes must also use hono's csrf().
 */
export const requireOwner: MiddlewareHandler<OwnerEnv> = async (c, next) => {
  const owner = await currentOwner(c)
  if (!owner) return c.json({ error: 'Sign in as the owner' }, 401)
  c.set('owner', owner)
  await next()
}
