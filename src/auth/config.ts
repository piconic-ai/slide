import { github } from 'better-auth/social-providers'
import { z } from 'zod'
import { oauthIntentSchema, githubUserSchema } from './github-oauth'
import { betterAuth } from 'better-auth'
import {
  addOAuthServerContext,
  createAuthMiddleware,
  getOAuthState,
} from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/auth-schema'
import { accounts } from '../db/schema'
import { handleOfLogin } from '../share/handle'
import { type GitHubUser } from './github-client'

export const OWNER_COOKIE = '__Host-slide_owner'
export const OAUTH_COOKIE = '__Host-slide_oauth'
export const OWNER_SESSION_SECONDS = 12 * 60 * 60

export function oauthConfig(env: Env) {
  return env.GITHUB_APP_CLIENT_ID &&
    env.GITHUB_APP_CLIENT_SECRET &&
    env.BETTER_AUTH_SECRET &&
    env.BETTER_AUTH_SECRET.length >= 32
    ? {
        clientId: env.GITHUB_APP_CLIENT_ID,
        clientSecret: env.GITHUB_APP_CLIENT_SECRET,
        secret: env.BETTER_AUTH_SECRET,
      }
    : null
}

export const continuationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('login') }),
  z.object({
    kind: z.literal('bind'),
    request: oauthIntentSchema.options[1].shape.request,
    sessionId: z.string(),
  }),
])
export type Continuation = z.input<typeof continuationSchema>
type Options = {
  continuation?: Continuation
  onIdentity?: (
    user: GitHubUser,
    token: string,
    state: Record<string, unknown> | undefined,
  ) => Promise<boolean>
  onToken?: (token: string) => void
}

export function createAuth(env: Env, options: Options = {}) {
  const config = oauthConfig(env)
  if (!config) return null
  const db = drizzle(env.DB)
  const provider = github({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    mapProfileToUser: (profile) => ({
      email: `${profile.id}@users.noreply.github.com`,
    }),
  })
  return betterAuth({
    appName: 'Slide',
    baseURL: env.PUBLIC_ORIGIN,
    basePath: '/auth',
    secret: config.secret,
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: {
        user: schema.authUser,
        account: schema.authAccount,
        session: schema.authSession,
        verification: schema.authVerification,
      },
      transaction: false,
    }),
    trustedOrigins: [env.PUBLIC_ORIGIN],
    socialProviders: {
      github: {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectURI: new URL('/auth/github/callback', env.PUBLIC_ORIGIN).href,
        disableDefaultScope: true,
        overrideUserInfoOnSignIn: true,
        async getUserInfo(tokens) {
          if (!tokens.accessToken) return null
          options.onToken?.(tokens.accessToken)
          const result = await provider.getUserInfo(tokens)
          if (!result) return null
          const parsed = githubUserSchema.safeParse({
            id: Number(result.data.id),
            login: result.data.login,
          })
          if (!parsed.success || String(parsed.data.id) !== env.GITHUB_ACTOR_ID)
            return null
          const user = parsed.data
          const state = await getOAuthState()
          if (
            options.onIdentity &&
            !(await options.onIdentity(
              user,
              tokens.accessToken,
              state?.serverContext,
            ))
          )
            return null
          // Better Auth requires an email; derive it from GitHub's immutable ID.
          return {
            user: {
              name: user.login,
              email: `${user.id}@users.noreply.github.com`,
              emailVerified: false,
            },
            data: result.data,
          }
        },
      },
    },
    account: {
      // Only this verified GitHub ID can own its synthetic email, including after a partial D1 signup.
      accountLinking: {
        enabled: true,
        trustedProviders: ['github'],
        requireLocalEmailVerified: false,
      },
      storeStateStrategy: 'database',
      updateAccountOnSignIn: false,
    },
    user: { deleteUser: { enabled: false } },
    session: {
      expiresIn: OWNER_SESSION_SECONDS,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    advanced: {
      // Explicit __Host names keep both cookies host-only, including local HTTPS.
      useSecureCookies: false,
      defaultCookieAttributes: {
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      },
      cookies: {
        session_token: { name: OWNER_COOKIE },
        state: { name: OAUTH_COOKIE },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-in/social' && options.continuation)
          await addOAuthServerContext(options.continuation)
      }),
    },
    databaseHooks: {
      account: {
        create: {
          before: async (account) => ({
            data: {
              ...account,
              accessToken: null,
              refreshToken: null,
              idToken: null,
            },
          }),
        },
        update: {
          before: async (account) => ({
            data: {
              ...account,
              accessToken: null,
              refreshToken: null,
              idToken: null,
            },
          }),
        },
      },
      session: {
        create: {
          before: async (session) => ({
            data: { ...session, ipAddress: null, userAgent: null },
          }),
          after: async (session) => {
            const [record] = await db
              .select({
                githubId: schema.authAccount.accountId,
                login: schema.authUser.name,
              })
              .from(schema.authAccount)
              .innerJoin(
                schema.authUser,
                eq(schema.authAccount.userId, schema.authUser.id),
              )
              .where(eq(schema.authAccount.userId, session.userId))
            const handle = record && handleOfLogin(record.login)
            if (handle)
              await db
                .insert(accounts)
                .values({
                  user_id: record.githubId,
                  handle,
                  created_at: Math.floor(Date.now() / 1000),
                })
                .onConflictDoNothing()
          },
        },
      },
    },
  })
}
