import { describe, expect, test } from 'vitest'
import { fetchGravatar } from './gravatar-client'

const answer = (body: BodyInit | null, init: ResponseInit) =>
  (async () => new Response(body, init)) as unknown as typeof fetch

describe('F28-AC50: Gravatar has a picture, has none, or does not answer', () => {
  test('Given Gravatar answers with a picture, When it is asked, Then the bytes and their type come back', async () => {
    const result = await fetchGravatar(
      'h',
      answer(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Type': 'image/png' },
      }),
    )
    expect(result).toEqual({
      kind: 'image',
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
    })
  })
  test('Given Gravatar answers 404, When it is asked, Then there is none', async () => {
    expect(await fetchGravatar('h', answer('x', { status: 404 }))).toEqual({
      kind: 'none',
    })
  })
  test.each([
    ['a server error', answer('x', { status: 500 })],
    ['a rate limit', answer('x', { status: 429 })],
    ['a redirect that was not followed', answer(null, { status: 302 })],
    [
      'HTML where a picture should be',
      answer('<script>alert(1)</script>', {
        headers: { 'Content-Type': 'text/html' },
      }),
    ],
    [
      'an SVG',
      answer('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }),
    ],
    [
      'an empty picture',
      answer(new Uint8Array(0), { headers: { 'Content-Type': 'image/png' } }),
    ],
    [
      'a picture over 1 MB',
      answer(new Uint8Array(1024 * 1024 + 1), {
        headers: { 'Content-Type': 'image/png' },
      }),
    ],
    [
      'a refused connection',
      (async () => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof fetch,
    ],
    [
      'no answer in time',
      (async () => {
        throw new DOMException('timed out', 'TimeoutError')
      }) as unknown as typeof fetch,
    ],
  ])(
    'Given %s, When Gravatar is asked, Then it is unreachable and nothing is thrown',
    async (_, fetcher) => {
      expect(await fetchGravatar('h', fetcher)).toEqual({ kind: 'unreachable' })
    },
  )
  test('Given a type with a parameter and capitals, When Gravatar is asked, Then it is still read as an image', async () => {
    const result = await fetchGravatar(
      'h',
      answer(new Uint8Array([1]), {
        headers: { 'Content-Type': 'Image/JPEG; charset=binary' },
      }),
    )
    expect(result).toMatchObject({ kind: 'image', contentType: 'image/jpeg' })
  })
  test('Given a request, When it is sent, Then only the hash is in the address, with no referrer and no cookies', async () => {
    let seen: { url: string; init?: RequestInit } | undefined
    await fetchGravatar('thehash', (async (url: string, init?: RequestInit) => {
      seen = { url, init }
      return new Response('x', { status: 404 })
    }) as unknown as typeof fetch)
    expect(seen?.url).toBe('https://gravatar.com/avatar/thehash?s=256&d=404')
    expect(seen?.init).toMatchObject({
      referrerPolicy: 'no-referrer',
      credentials: 'omit',
    })
    expect(seen?.init?.signal).toBeInstanceOf(AbortSignal)
  })
})
