/**
 * A copy of src/alerts/webhook-url.ts, on purpose: the watcher does not read
 * the service's code, so that a fault in the service cannot take it down
 * too. Keep the two alike (watcher/src/webhook-url.pure.test.ts runs the same
 * cases).
 */
declare const webhookBrand: unique symbol
export type WebhookUrl = string & { readonly [webhookBrand]: true }

const HOSTS: ReadonlySet<string> = new Set([
  'discord.com',
  'ptb.discord.com',
  'canary.discord.com',
  'discordapp.com',
])
const PATH =
  /^\/api(?:\/v\d{1,2})?\/webhooks\/\d{15,25}\/[A-Za-z0-9._-]{20,200}$/

/** The secret as a Discord webhook address, or null. The value is a credential. */
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
