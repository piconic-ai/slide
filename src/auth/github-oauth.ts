import { z } from 'zod'
import { bindingRequestSchema } from '../decks/binding'

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'

/** What the owner asked for before leaving for GitHub. */
export const oauthIntentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('login') }),
  z.strictObject({ kind: z.literal('bind'), request: bindingRequestSchema }),
])
export type OAuthIntent = z.infer<typeof oauthIntentSchema>
type OAuthIntentInput = z.input<typeof oauthIntentSchema>

export type OAuthStart = Readonly<{
  state: string
  verifier: string
  intent: OAuthIntent
}>

export type OwnerDecision =
  | { readonly ok: true; readonly userId: string; readonly login: string }
  | { readonly ok: false }

const cookieSchema = z
  .string()
  .max(3500)
  .regex(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]+$/)
  .transform((value, context) => {
    const [state, verifier, encoded] = value.split('.') as [
      string,
      string,
      string,
    ]
    const intent = oauthIntentSchema.safeParse(decodeJson(encoded))
    if (!intent.success) {
      context.addIssue({ code: 'custom', message: 'Invalid OAuth intent' })
      return z.NEVER
    }
    return { state, verifier, intent: intent.data }
  })

function decodeJson(encoded: string): unknown {
  try {
    const binary = atob(encoded.replaceAll('-', '+').replaceAll('_', '/'))
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

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

export function serializeOAuthStart(start: {
  state: string
  verifier: string
  intent: OAuthIntentInput
}): string {
  const intent = base64Url(
    new TextEncoder().encode(JSON.stringify(start.intent)),
  )
  return `${start.state}.${start.verifier}.${intent}`
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
