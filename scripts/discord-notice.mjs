// What the release script may send to Discord, and how. The rules are those of
// src/alerts (webhook-url.ts, discord-client.ts, notice-text.ts), written again
// here because a script run by Workers Builds cannot import the Worker's
// TypeScript. Keep the two in step. Pure apart from the `send` it is given.

const HOSTS = new Set([
  'discord.com',
  'ptb.discord.com',
  'canary.discord.com',
  'discordapp.com',
])
// `/api/webhooks/<id>/<token>`, with the API version Discord may put between.
const PATH =
  /^\/api(?:\/v\d{1,2})?\/webhooks\/\d{15,25}\/[A-Za-z0-9._-]{20,200}$/

/**
 * The webhook address, or null when the value is not one. It must be https on
 * Discord's own host with the webhook path and nothing more, so a mistaken
 * value sends nothing and the secret cannot point a message at another host.
 * The value is a credential: nothing that calls this may print it.
 */
export function parseWebhookUrl(value) {
  if (!value) return null
  let url
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
  return plain ? url.href : null
}

const IPV4 = /\d{1,3}(?:\.\d{1,3}){3}/
const IPV6 = /[0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{0,4}){2,}/

/** Free of an `@` (an email address) and of anything shaped like an IP address. */
export const holdsNoPersonalData = (text) =>
  !text.includes('@') && !IPV4.test(text) && !IPV6.test(text)

/** The most Discord takes in one message. */
const CONTENT_MAX = 2000
/** SUPPRESS_EMBEDS: a link is not unfolded into a preview. */
const SUPPRESS_EMBEDS = 4

/**
 * Posts one message. No mention can ping anyone, and a redirect is not
 * followed. Returns how it ended: never the address, never Discord's answer.
 * @returns {Promise<'sent' | 'refused' | 'failed'>}
 */
export async function postToDiscord(url, text, send) {
  try {
    const response = await send(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: text.slice(0, CONTENT_MAX),
        username: 'slide',
        allowed_mentions: { parse: [] },
        flags: SUPPRESS_EMBEDS,
      }),
      redirect: 'manual',
    })
    return response.status >= 200 && response.status < 300 ? 'sent' : 'refused'
  } catch {
    return 'failed'
  }
}

/**
 * Tells Discord, if there is a webhook and the text is clean. Says what
 * happened in one line for the build log; the line names no address.
 */
export async function tell(webhook, text, send, log) {
  const url = parseWebhookUrl(webhook)
  if (!url) return log('notice not sent: no usable Discord webhook is set')
  if (!holdsNoPersonalData(text))
    return log('notice not sent: the text held personal data')
  log(`notice ${await postToDiscord(url, text, send)}`)
}
