import { SERVICE_NAME } from '../site/service'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { isAPIError } from 'better-auth/api'
import { emailOTP } from 'better-auth/plugins'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/auth-schema'
import { hashedIdentifier } from '../db/email-cipher'
import { emailBoundary } from '../db/email-adapter-store'
import { emailCryptoOf } from '../db/email-settings'
import { decryptCode, encryptCode } from './code-cipher'
import { deviceLabel, storedDeviceLabel } from './device-label'
import {
  OWNER_COOKIE,
  OWNER_SESSION_RENEW_SECONDS,
  OWNER_SESSION_SECONDS,
} from './config'
import { CODE_ATTEMPTS, CODE_LENGTH, CODE_SECONDS } from './login-policy'

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
  // Keys that are set but unusable stop sign-in altogether: carrying on would
  // write plain addresses beside sealed ones (F41-AC14).
  const email = emailCryptoOf(env)
  if (email.kind === 'invalid') return null
  const db = drizzle(env.DB)
  const { waitUntil } = options
  return betterAuth({
    appName: SERVICE_NAME,
    baseURL: env.PUBLIC_ORIGIN,
    basePath: '/auth',
    secret,
    // The address is sealed on its way into D1 and opened on its way out, so
    // Better Auth works with the address as it always did (F41-AC16).
    database: emailBoundary(
      drizzleAdapter(db, {
        provider: 'sqlite',
        schema: {
          user: schema.authUser,
          account: schema.authAccount,
          session: schema.authSession,
          verification: schema.authVerification,
        },
        transaction: false,
      }),
      { config: email, database: env.DB },
    ),
    // A code's row is named after the address it went to; with the keys on,
    // the name is a keyed hash instead.
    ...(email.kind === 'on'
      ? {
          verification: {
            storeIdentifier: {
              hash: (identifier: string) => hashedIdentifier(email, identifier),
            },
          },
        }
      : {}),
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
    user: {
      deleteUser: { enabled: false },
      // The sealed address rides along in the user row; the boundary takes it
      // off before Better Auth sees the row.
      additionalFields: {
        emailCiphertext: {
          type: 'string',
          required: false,
          input: false,
          returned: false,
        },
      },
    },
    session: {
      expiresIn: OWNER_SESSION_SECONDS,
      updateAge: OWNER_SESSION_RENEW_SECONDS,
      additionalFields: {
        device: { type: 'string', required: false, input: false },
      },
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
          // Only the device's rough name is kept, never the agent or the
          // address it came from (F28-AC111).
          before: async (session) => ({
            data: {
              ...session,
              device: storedDeviceLabel(deviceLabel(session.userAgent)),
              ipAddress: null,
              userAgent: null,
            },
          }),
        },
      },
    },
  })
}

/**
 * Reads the session, renewing it when due. A session whose row went between
 * Better Auth's read and its renewal (another device signed it out) makes
 * Better Auth throw 401; that request is simply signed out.
 */
export async function readSession(
  auth: NonNullable<ReturnType<typeof createAuth>>,
  request: Request,
) {
  try {
    return await auth.api.getSession({
      headers: request.headers,
      returnHeaders: true,
    })
  } catch (error) {
    // Only the vanished row; a failing database must still fail loudly.
    if (isAPIError(error) && error.statusCode === 401) return null
    throw error
  }
}
