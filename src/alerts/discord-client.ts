import type { WebhookUrl } from './webhook-url'

/** How one post ended. Nothing of the answer or the address is kept. */
export type PostResult =
  | Readonly<{ kind: 'sent' }>
  | Readonly<{ kind: 'refused'; status: number }>
  | Readonly<{ kind: 'failed'; reason: 'timeout' | 'network' }>

/** Discord's limit on the text of a message. */
const CONTENT_MAX = 2000

/** SUPPRESS_EMBEDS: a link in an alert is not unfolded into a preview. */
const SUPPRESS_EMBEDS = 4

/**
 * Posts a message to a Discord webhook (D-57, D-58), after the Execute
 * Webhook call of https://docs.discord.com/developers/resources/webhook.
 * No mention is allowed to ping anyone. A redirect is not followed, so the
 * secret address cannot lead anywhere else. The address is a credential and
 * is neither logged nor put in a result: only a status or a reason comes back.
 * `send` is the platform's `fetch`; a test hands in its own.
 */
export async function postToDiscord(
  url: WebhookUrl,
  text: string,
  send: typeof fetch = fetch,
): Promise<PostResult> {
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
      signal: AbortSignal.timeout(5000),
    })
    return response.status >= 200 && response.status < 300
      ? { kind: 'sent' }
      : { kind: 'refused', status: response.status }
  } catch (error) {
    return {
      kind: 'failed',
      reason:
        error instanceof Error && error.name === 'TimeoutError'
          ? 'timeout'
          : 'network',
    }
  }
}
