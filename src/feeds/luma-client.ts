/**
 * The one place the service asks Luma for anything (D-67, F33-AC17): a
 * calendar's iCal feed, and only through `readLumaFeed`.
 */
import {
  answerOfStatus,
  declaredTooLarge,
  feedRequestHeaders,
  validatorsOf,
  type FeedAnswer,
  type FeedFailure,
  type Validators,
} from './feed-answer'
import { FEED_TIMEOUT_MS, MAX_FEED_BYTES } from './limits'
import { lumaFeedTarget } from './luma-url'

/**
 * What sends a request. Workers' own fetch in production; the local feed
 * (src/feeds/mock-routes.ts) when started locally, and a fake in tests.
 */
export type FeedTransport = (request: Request) => Promise<Response>

/** Workers' fetch: the only request to Luma in the source. */
export const lumaTransport: FeedTransport = (request) => fetch(request)

class Cut extends Error {
  constructor(readonly reason: FeedFailure) {
    super(reason)
  }
}

/** The body, read up to MAX_FEED_BYTES; a longer one is cut off. */
async function bodyOf(response: Response): Promise<string> {
  if (declaredTooLarge(response.headers, MAX_FEED_BYTES)) {
    await response.body?.cancel()
    throw new Cut('too_large')
  }
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_FEED_BYTES) {
      await reader.cancel()
      throw new Cut('too_large')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

async function ask(
  target: string,
  sent: Validators,
  transport: FeedTransport,
  signal: AbortSignal,
): Promise<FeedAnswer> {
  const response = await transport(
    new Request(target, {
      method: 'GET',
      headers: feedRequestHeaders(sent),
      // A redirect could lead anywhere; it is a failure (D-67).
      redirect: 'manual',
      signal,
    }),
  )
  const answer = answerOfStatus(response.status, response.headers, sent)
  if (answer.kind !== 'read') {
    await response.body?.cancel()
    return answer
  }
  return {
    kind: 'full',
    body: await bodyOf(response),
    validators: validatorsOf(response.headers),
  }
}

/**
 * Asks Luma for a calendar's feed, once. Nothing is asked unless the
 * address is a calendar's feed (D-67). The request carries the bot's
 * User-Agent and the validators of the last full answer, follows no
 * redirect, and is cut off past MAX_FEED_BYTES or FEED_TIMEOUT_MS, body
 * included (D-64). It never throws: every way it can fail is an answer.
 */
export async function readLumaFeed(
  address: string,
  sent: Validators,
  transport: FeedTransport = lumaTransport,
): Promise<FeedAnswer> {
  const target = lumaFeedTarget(address)
  if (target === null)
    return { kind: 'failed', reason: 'refused', retryAfter: null }
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  // The timer wins even over a transport that ignores the signal.
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Cut('timeout'))
    }, FEED_TIMEOUT_MS)
  })
  try {
    return await Promise.race([
      ask(target, sent, transport, controller.signal),
      late,
    ])
  } catch (error) {
    return {
      kind: 'failed',
      reason: error instanceof Cut ? error.reason : 'network',
      retryAfter: null,
    }
  } finally {
    clearTimeout(timer)
  }
}
