const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/**
 * Asks Cloudflare whether a Turnstile token is good. A token that is
 * missing, refused, or unanswered by Cloudflare fails: the check never
 * opens when it cannot be made.
 */
export async function verifyTurnstile(
  secret: string,
  token: string,
  ip: string | null,
): Promise<boolean> {
  if (token === '' || token.length > 2048) return false
  const body = new URLSearchParams({ secret, response: token })
  if (ip) body.set('remoteip', ip)
  try {
    const response = await fetch(SITEVERIFY, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return false
    const answer: unknown = await response.json()
    return (
      typeof answer === 'object' &&
      answer !== null &&
      (answer as { success?: unknown }).success === true
    )
  } catch {
    return false
  }
}
