import { SERVICE_NAME } from '../site/service'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { emailOTP } from 'better-auth/plugins'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/auth-schema'
import { decryptCode, encryptCode } from './code-cipher'
import { CODE_ATTEMPTS, CODE_LENGTH, CODE_SECONDS } from './login-policy'

export const OWNER_COOKIE = '__Host-slide_owner'
/** A sign-in ends after a day without use (F28-AC104). */
export const OWNER_SESSION_SECONDS = 24 * 60 * 60
/** Using the service moves the end forward, at most once an hour. */
export const OWNER_SESSION_RENEW_SECONDS = 60 * 60

/** The secret that signs sessions and keys the stored codes, when set well. */
export function authSecret(env: Env): string | null {
  return env.BETTER_AUTH_SECRET && env.BETTER_AUTH_SECRET.length >= 32
    ? env.BETTER_AUTH_SECRET
    : null
}

type Options = {
  /** Called with a code Better Auth made; the caller decides whether to send it. */
  onCode?: (email: string, code: string) => Promise<void>
  /** Keeps work running after the response, where the platform allows. */
  waitUntil?: (promise: Promise<unknown>) => void
}

/**
 * Better Auth with the email one-time code: a 6-digit code that lasts 10
 * minutes, takes 5 wrong tries and is consumed by its first use
 * (docs/dev/f28-email-login.md). Only the endpoints through `auth.api` are
 * reachable; the service mounts no Better Auth handler of its own.
 */
export function createAuth(env: Env, options: Options = {}) {
  const secret = authSecret(env)
  if (!secret) return null
  const db = drizzle(env.DB)
  const { waitUntil } = options
  return betterAuth({
    appName: SERVICE_NAME,
    baseURL: env.PUBLIC_ORIGIN,
    basePath: '/auth',
    secret,
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
    plugins: [
      emailOTP({
        otpLength: CODE_LENGTH,
        expiresIn: CODE_SECONDS,
        allowedAttempts: CODE_ATTEMPTS,
        // Stored sealed, so a second request for the same address can send the
        // same code again instead of voiding the one the person holds.
        storeOTP: {
          encrypt: (code) => encryptCode(secret, code),
          decrypt: (stored) => decryptCode(secret, stored),
        },
        resendStrategy: 'reuse',
        async sendVerificationOTP({ email, otp }) {
          await options.onCode?.(email, otp)
        },
      }),
    ],
    user: { deleteUser: { enabled: false } },
    session: {
      expiresIn: OWNER_SESSION_SECONDS,
      updateAge: OWNER_SESSION_RENEW_SECONDS,
      cookieCache: { enabled: false },
    },
    advanced: {
      // Explicit __Host names keep the cookie host-only, including local HTTPS.
      useSecureCookies: false,
      defaultCookieAttributes: {
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      },
      cookies: { session_token: { name: OWNER_COOKIE } },
      ...(waitUntil ? { backgroundTasks: { handler: waitUntil } } : {}),
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => ({
            data: { ...session, ipAddress: null, userAgent: null },
          }),
        },
      },
    },
  })
}
