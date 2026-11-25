/**
 * The local feed (D-69): answers like Luma's feed, from src/feeds/mock-feed.ts,
 * without leaving the Worker. Only a local start that asks for it has it
 * (F33-AC15); see feedModeOf.
 */
import { Hono } from 'hono'
import { feedModeOf } from './feed-mode'
import type { FeedTransport } from './luma-client'
import { LUMA_FEED_PATH } from './luma-url'
import { mockAnswer, type MockAnswer } from './mock-feed'

/** The path the local feed answers on, for curl. */
export const MOCK_FEED_BASE = '/__mock/luma'

const waitOrAbort = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    })
  })

async function responseOf(answer: MockAnswer, signal: AbortSignal) {
  switch (answer.kind) {
    case 'fixed':
      return new Response(answer.body, {
        status: answer.status,
        headers: answer.headers,
      })
    case 'large': {
      let left = answer.bytes
      const chunk = new Uint8Array(64 * 1024).fill(0x41)
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (left <= 0) return controller.close()
            const part = chunk.subarray(0, Math.min(left, chunk.length))
            left -= part.length
            controller.enqueue(part)
          },
        }),
        { headers: { 'Content-Type': 'text/calendar' } },
      )
    }
    case 'slow':
      await waitOrAbort(answer.ms, signal)
      return new Response(answer.body, {
        headers: { 'Content-Type': 'text/calendar' },
      })
  }
}

/** Answers one request for a feed the way the local feed does. */
async function answerFeed(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const headers = request.headers
  // The log is the record of what reached "Luma": who asked, and with
  // which validators.
  console.log(
    JSON.stringify({
      event: 'luma_mock_request',
      id: url.searchParams.get('id'),
      userAgent: headers.get('User-Agent'),
      ifNoneMatch: headers.get('If-None-Match'),
      ifModifiedSince: headers.get('If-Modified-Since'),
    }),
  )
  return responseOf(
    mockAnswer(url.searchParams.get('id') ?? '', {
      ifNoneMatch: headers.get('If-None-Match'),
      ifModifiedSince: headers.get('If-Modified-Since'),
    }),
    request.signal,
  )
}

/**
 * Sends the reader's requests to the local feed instead of Luma. The
 * reader checked the address already; only its query is used.
 */
export const mockTransport: FeedTransport = (request) => answerFeed(request)

/** The local feed on `MOCK_FEED_BASE`, answering 404 unless it is on. */
export const mockFeedRoutes = new Hono<{ Bindings: Env }>()
mockFeedRoutes.use(async (c, next) => {
  const mode = feedModeOf({
    mock: c.env.LUMA_FEED_MOCK,
    publicOrigin: c.env.PUBLIC_ORIGIN,
  })
  if (mode !== 'mock') return c.notFound()
  await next()
})
mockFeedRoutes.get(LUMA_FEED_PATH, (c) => answerFeed(c.req.raw))
