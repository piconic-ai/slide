import { afterEach, describe, expect, test, vi } from 'vitest'
import { readLumaFeed, type FeedTransport } from './luma-client'

const FEED = 'https://api.lu.ma/ics/get?entity=calendar&id=cal-abc123'
const none = { etag: null, lastModified: null }
const ICS = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'

/** A transport that answers with `answer` and keeps what it was asked. */
function recording(answer: () => Response | Promise<Response>) {
  const asked: Request[] = []
  const transport: FeedTransport = async (request) => {
    asked.push(request)
    return answer()
  }
  return { asked, transport }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('asking Luma for a feed', () => {
  test("F33-AC6: Given a feed, When it is asked for, Then the request goes to it with the bot's User-Agent, by GET, following no redirect", async () => {
    const { asked, transport } = recording(() => new Response(ICS))
    const answer = await readLumaFeed(FEED, none, transport)
    expect(answer).toEqual({
      kind: 'full',
      body: ICS,
      validators: none,
    })
    expect(asked).toHaveLength(1)
    const [request] = asked
    expect(request?.url).toBe(FEED)
    expect(request?.method).toBe('GET')
    expect(request?.redirect).toBe('manual')
    expect(request?.headers.get('User-Agent')).toBe(
      'slide.community-bot/1.0 (+https://slide.community/help/bot)',
    )
    expect(request?.headers.has('Cookie')).toBe(false)
    expect(request?.headers.has('Authorization')).toBe(false)
  })

  test('F33-AC5: Given validators of the last answer, When the feed is asked for again, Then the request is conditional and a 304 keeps them', async () => {
    const sent = { etag: '"v1"', lastModified: 'Tue, 24 Nov 2026 00:00:00 GMT' }
    const { asked, transport } = recording(
      () => new Response(null, { status: 304 }),
    )
    expect(await readLumaFeed(FEED, sent, transport)).toEqual({
      kind: 'not_modified',
      validators: sent,
    })
    expect(asked[0]?.headers.get('If-None-Match')).toBe('"v1"')
    expect(asked[0]?.headers.get('If-Modified-Since')).toBe(
      'Tue, 24 Nov 2026 00:00:00 GMT',
    )
  })

  test('F33-AC5: Given a full answer with validators, When it is read, Then they are returned to keep', async () => {
    const { transport } = recording(
      () =>
        new Response(ICS, {
          headers: {
            ETag: '"v2"',
            'Last-Modified': 'Wed, 25 Nov 2026 00:00:00 GMT',
          },
        }),
    )
    expect(await readLumaFeed(FEED, none, transport)).toMatchObject({
      kind: 'full',
      validators: {
        etag: '"v2"',
        lastModified: 'Wed, 25 Nov 2026 00:00:00 GMT',
      },
    })
  })

  test.each([
    'https://evil.example/ics/get?entity=calendar&id=cal-abc123',
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost:8770/__mock/luma/ics/get?entity=calendar&id=cal-abc123',
    'https://api.lu.ma/ics/get?entity=calendar&id=cal-abc123&x=1',
    'file:///etc/passwd',
  ])(
    'F33-AC10: Given %s, When it is asked for, Then nothing is sent and it fails as refused',
    async (address) => {
      const { asked, transport } = recording(() => new Response(ICS))
      expect(await readLumaFeed(address, none, transport)).toEqual({
        kind: 'failed',
        reason: 'refused',
        retryAfter: null,
      })
      expect(asked).toHaveLength(0)
    },
  )

  test('F33-AC10: Given Luma answers with a redirect, When the feed is asked for, Then it fails and the redirect is not followed', async () => {
    const { asked, transport } = recording(
      () =>
        new Response(null, {
          status: 302,
          headers: { Location: 'http://169.254.169.254/' },
        }),
    )
    expect(await readLumaFeed(FEED, none, transport)).toEqual({
      kind: 'failed',
      reason: 'redirect',
      retryAfter: null,
    })
    expect(asked).toHaveLength(1)
  })

  test('F33-AC7: Given a 429 with Retry-After, When the feed is asked for, Then the failure carries it', async () => {
    const { transport } = recording(
      () =>
        new Response('slow down', {
          status: 429,
          headers: { 'Retry-After': '7200' },
        }),
    )
    expect(await readLumaFeed(FEED, none, transport)).toEqual({
      kind: 'failed',
      reason: 'rate_limited',
      retryAfter: '7200',
    })
  })

  test('F33-AC11: Given an answer declaring more than 2 MB, When it is read, Then it is cut off as too large', async () => {
    const { transport } = recording(
      () =>
        new Response('x', {
          headers: { 'Content-Length': String(2 * 1024 * 1024 + 1) },
        }),
    )
    expect(await readLumaFeed(FEED, none, transport)).toMatchObject({
      kind: 'failed',
      reason: 'too_large',
    })
  })

  test('F33-AC11: Given a stream longer than 2 MB with no length, When it is read, Then it is cut off as too large without reading the rest', async () => {
    let pulled = 0
    const chunk = new Uint8Array(256 * 1024)
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(chunk)
      },
    })
    const { transport } = recording(() => new Response(endless))
    expect(await readLumaFeed(FEED, none, transport)).toMatchObject({
      kind: 'failed',
      reason: 'too_large',
    })
    expect(pulled).toBeLessThanOrEqual(10)
  })

  test('F33-AC11: Given an answer of exactly 2 MB, When it is read, Then it is read whole', async () => {
    const body = 'x'.repeat(2 * 1024 * 1024)
    const { transport } = recording(() => new Response(body))
    const answer = await readLumaFeed(FEED, none, transport)
    expect(answer.kind === 'full' ? answer.body.length : 0).toBe(body.length)
  })

  test('F33-AC11: Given a transport that never answers, When 10 seconds pass, Then the request is aborted and fails as a timeout', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const transport: FeedTransport = (request) => {
      signal = request.signal
      return new Promise<never>(() => {})
    }
    const answer = readLumaFeed(FEED, none, transport)
    await vi.advanceTimersByTimeAsync(9_999)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await answer).toMatchObject({ kind: 'failed', reason: 'timeout' })
    expect(signal?.aborted).toBe(true)
  })

  test('F33-AC11: Given headers at once and a body that trickles past 10 seconds, When it is read, Then it fails as a timeout', async () => {
    vi.useFakeTimers()
    const trickle = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        controller.enqueue(new TextEncoder().encode('x'))
      },
    })
    const answer = readLumaFeed(FEED, none, async () => new Response(trickle))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await answer).toMatchObject({ kind: 'failed', reason: 'timeout' })
  })

  test('Given a transport that throws, When the feed is asked for, Then it fails as a network failure', async () => {
    const answer = await readLumaFeed(FEED, none, async () => {
      throw new TypeError('connection refused')
    })
    expect(answer).toEqual({
      kind: 'failed',
      reason: 'network',
      retryAfter: null,
    })
  })
})
