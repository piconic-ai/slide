import { z } from 'zod'

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'

export type OAuthStart = Readonly<{ state: string; verifier: string }>

export type OwnerDecision =
  | { readonly ok: true; readonly userId: string; readonly login: string }
  | { readonly ok: false }

const cookieSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/)
  .transform((value) => {
    const [state, verifier] = value.split('.') as [string, string]
    return { state, verifier }
  })

export const tokenResponseSchema = z.union([
  z.object({ access_token: z.string().min(1) }),
  z.object({ error: z.string() }),
])

export const githubUserSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1).max(39),
})

export function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

/** The PKCE S256 challenge for a verifier. */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )
  return base64Url(new Uint8Array(digest))
}

export function authorizeUrl(input: {
  clientId: string
  redirectUri: string
  state: string
  challenge: string
}): string {
  const url = new URL(AUTHORIZE_URL)
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
    allow_signup: 'false',
  }).toString()
  return url.href
}

export function serializeOAuthStart(start: OAuthStart): string {
  return `${start.state}.${start.verifier}`
}

export function parseOAuthStart(value: string | undefined): OAuthStart | null {
  const parsed = cookieSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** Only the configured GitHub user ID may hold an owner session. */
export function ownerDecision(
  user: z.infer<typeof githubUserSchema>,
  allowedUserId: string,
): OwnerDecision {
  return String(user.id) === allowedUserId
    ? { ok: true, userId: String(user.id), login: user.login }
    : { ok: false }
}
