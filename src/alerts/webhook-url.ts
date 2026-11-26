declare const webhookBrand: unique symbol
/** A Discord webhook address that `parseWebhookUrl` accepted. */
export type WebhookUrl = string & { readonly [webhookBrand]: true }

const HOSTS: ReadonlySet<string> = new Set([
  'discord.com',
  'ptb.discord.com',
  'canary.discord.com',
  'discordapp.com',
])
// `/api/webhooks/<id>/<token>`, with the API version Discord may put between.
const PATH =
  /^\/api(?:\/v\d{1,2})?\/webhooks\/\d{15,25}\/[A-Za-z0-9._-]{20,200}$/

/**
 * The secret as a webhook address, or null when it is not one (D-58). It must
 * be https on Discord's own host with the webhook path and nothing more: no
 * port, user information, query or fragment. A mistaken value therefore never
 * sends anything, and the secret cannot point alerts at another host. The
 * value is a credential: nothing here, or in its callers, may print it.
 */
export function parseWebhookUrl(value: string | undefined): WebhookUrl | null {
  if (!value) return null
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  const plain =
    url.protocol === 'https:' &&
    HOSTS.has(url.hostname) &&
    !url.port &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    PATH.test(url.pathname)
  return plain ? (url.href as WebhookUrl) : null
}
