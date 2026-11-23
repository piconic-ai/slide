import { describe, expect, test, vi } from 'vitest'
import { fetchLinkTitle, WAIT_MILLISECONDS } from './title-client'
import { MAX_PAGE_BYTES } from './title-parse'

const OWN = ['slide.example', 'content.example']
const html = (body: string, init: ResponseInit = {}) =>
  new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    ...init,
  })
const redirect = (to: string, status = 302) =>
  new Response(null, { status, headers: { location: to } })

/** A fetcher that answers each address from a table, and records what was asked. */
function site(table: Record<string, () => Response | Promise<Response>>) {
  const asked: { url: string; init: RequestInit | undefined }[] = []
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      asked.push({ url, init })
      const answer = table[url]
      if (!answer) throw new Error(`unexpected request to ${url}`)
      return answer()
    },
  ) as unknown as typeof fetch
  return { fetcher, asked }
}
const title = (address: string, fetcher: typeof fetch) =>
  fetchLinkTitle(address, { ownHosts: OWN, fetcher })

describe('fetchLinkTitle', () => {
  test('F27-AC23: Given a page with a title, When looked up, Then it is the title', async () => {
    const { fetcher } = site({
      'https://example.com/a': () => html('<title>Hello &amp; welcome</title>'),
    })
    expect(await title('https://example.com/a', fetcher)).toBe(
      'Hello & welcome',
    )
  })

  test('F27-AC23: Given a page in Japanese, When looked up, Then the title is kept', async () => {
    const { fetcher } = site({
      'https://example.com/': () => html('<title>発表の録画</title>'),
    })
    expect(await title('https://example.com/', fetcher)).toBe('発表の録画')
  })

  test('F27-AC27: Given a lookup, When it asks, Then it sends no cookie, no Authorization and no referrer, and says who it is', async () => {
    const { fetcher, asked } = site({
      'https://example.com/': () => html('<title>T</title>'),
    })
    await title('https://example.com/', fetcher)
    const init = asked[0]?.init
    expect(init?.method).toBe('GET')
    expect(init?.redirect).toBe('manual')
    expect(init?.credentials).toBe('omit')
    expect(init?.referrerPolicy).toBe('no-referrer')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(init?.headers).toEqual({
      Accept: 'text/html',
      'User-Agent': 'slide-link-title/1.0',
    })
  })

  test.each([
    ['an IP address', 'https://93.184.216.34/'],
    ['localhost', 'https://localhost/'],
    ['a .internal name', 'https://db.internal/'],
    ['a .local name', 'https://nas.local/'],
    ['another port', 'https://example.com:8443/'],
    ['a user name', 'https://u:p@example.com/'],
    ['http', 'http://example.com/'],
    ['the service itself', 'https://slide.example/@a/b'],
    ['its content domain', 'https://d-1.content.example/'],
  ])(
    'F27-AC25: Given %s, When looked up, Then no request is made and there is no title',
    async (_, address) => {
      const { fetcher, asked } = site({})
      expect(await title(address, fetcher)).toBeNull()
      expect(asked).toEqual([])
    },
  )

  test('F27-AC26: Given three redirects to a page, When looked up, Then they are followed and the title is read', async () => {
    const { fetcher, asked } = site({
      'https://a.example/': () => redirect('https://b.example/1', 301),
      'https://b.example/1': () => redirect('/2', 307),
      'https://b.example/2': () => redirect('https://c.example/3', 308),
      'https://c.example/3': () => html('<title>Arrived</title>'),
    })
    expect(await title('https://a.example/', fetcher)).toBe('Arrived')
    expect(asked.map((one) => one.url)).toEqual([
      'https://a.example/',
      'https://b.example/1',
      'https://b.example/2',
      'https://c.example/3',
    ])
  })

  test('F27-AC26: Given a fourth redirect, When looked up, Then it is not followed and there is no title', async () => {
    const { fetcher, asked } = site({
      'https://a.example/': () => redirect('https://a.example/1'),
      'https://a.example/1': () => redirect('https://a.example/2'),
      'https://a.example/2': () => redirect('https://a.example/3'),
      'https://a.example/3': () => redirect('https://a.example/4'),
      'https://a.example/4': () => html('<title>Too far</title>'),
    })
    expect(await title('https://a.example/', fetcher)).toBeNull()
    expect(asked).toHaveLength(4)
  })

  test.each([
    ['to an IP address', 'https://10.0.0.1/'],
    ['to localhost', 'https://localhost/admin'],
    ['to an .internal name', 'https://meta.internal/'],
    ['to another port', 'https://example.com:9000/'],
    ['to http', 'http://example.com/'],
    ['to the service itself', 'https://slide.example/slides'],
    ['to the content domain', 'https://d-2.content.example/'],
    ['to the cloud metadata address', 'https://169.254.169.254/'],
    ['to an address with a user name', 'https://u@example.com/'],
  ])(
    'F27-AC26: Given a redirect %s, When looked up, Then that place is not asked and there is no title',
    async (_, target) => {
      const { fetcher, asked } = site({
        'https://a.example/': () => redirect(target),
      })
      expect(await title('https://a.example/', fetcher)).toBeNull()
      expect(asked.map((one) => one.url)).toEqual(['https://a.example/'])
    },
  )

  test('F27-AC26: Given a redirect with no place or an unreadable one, When looked up, Then there is no title', async () => {
    const none = site({
      'https://a.example/': () => new Response(null, { status: 302 }),
    })
    expect(await title('https://a.example/', none.fetcher)).toBeNull()
    const odd = site({ 'https://a.example/': () => redirect('http://[bad') })
    expect(await title('https://a.example/', odd.fetcher)).toBeNull()
  })

  test.each([
    ['not found', () => html('<title>Gone</title>', { status: 404 })],
    ['a server error', () => html('<title>Oops</title>', { status: 500 })],
    ['a 204', () => new Response(null, { status: 204 })],
    [
      'JSON',
      () =>
        html('{"a":1}', { headers: { 'content-type': 'application/json' } }),
    ],
    [
      'an image',
      () => new Response('x', { headers: { 'content-type': 'image/png' } }),
    ],
    ['no type', () => new Response('<title>T</title>')],
    [
      'a PDF',
      () => html('%PDF', { headers: { 'content-type': 'application/pdf' } }),
    ],
  ])(
    'F27-AC24: Given a page that answers %s, When looked up, Then there is no title',
    async (_, answer) => {
      const { fetcher } = site({ 'https://example.com/': answer })
      expect(await title('https://example.com/', fetcher)).toBeNull()
    },
  )

  test('F27-AC24: Given a page without a title or with one that may not be kept, When looked up, Then there is no title', async () => {
    for (const body of [
      '<html><body>none</body></html>',
      '<title>a&#7;b</title>',
      '<title>&#x200b;</title>',
    ]) {
      const { fetcher } = site({ 'https://example.com/': () => html(body) })
      expect(await title('https://example.com/', fetcher)).toBeNull()
    }
  })

  test('F27-AC24: Given a fetch that fails, When looked up, Then there is no title and no error', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('network down')
    }) as unknown as typeof fetch
    expect(await title('https://example.com/', failing)).toBeNull()
  })

  test('F27-AC27: Given a page longer than the limit, When looked up, Then only its start is read and the stream is cancelled', async () => {
    let cancelled = false
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 16 * 1024
        controller.enqueue(
          new TextEncoder().encode(
            sent === 16 * 1024
              ? '<title>Start</title>' + 'x'.repeat(16 * 1024 - 20)
              : 'x'.repeat(16 * 1024),
          ),
        )
      },
      cancel() {
        cancelled = true
      },
    })
    const { fetcher } = site({
      'https://example.com/': () =>
        new Response(body, { headers: { 'content-type': 'text/html' } }),
    })
    expect(await title('https://example.com/', fetcher)).toBe('Start')
    expect(cancelled).toBe(true)
    expect(sent).toBeLessThanOrEqual(MAX_PAGE_BYTES + 16 * 1024)
  })

  test('F27-AC27: Given a title that comes after the limit, When looked up, Then there is no title', async () => {
    const page = 'x'.repeat(MAX_PAGE_BYTES) + '<title>Late</title>'
    const { fetcher } = site({ 'https://example.com/': () => html(page) })
    expect(await title('https://example.com/', fetcher)).toBeNull()
  })

  test('F27-AC27: Given a server that never answers, When looked up, Then it gives up after the time allowed and there is no title', async () => {
    vi.useFakeTimers()
    try {
      const hanging = vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(init.signal?.reason),
            )
          }),
      ) as unknown as typeof fetch
      const lookup = title('https://example.com/', hanging)
      await vi.advanceTimersByTimeAsync(WAIT_MILLISECONDS + 10)
      expect(await lookup).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  test('F27-AC27: Given a body that stalls after the headers, When looked up, Then it gives up after the time allowed', async () => {
    vi.useFakeTimers()
    try {
      const stalling = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              init?.signal?.addEventListener('abort', () =>
                controller.error(init.signal?.reason),
              )
            },
          })
          return new Response(body, {
            headers: { 'content-type': 'text/html' },
          })
        },
      ) as unknown as typeof fetch
      const lookup = title('https://example.com/', stalling)
      await vi.advanceTimersByTimeAsync(WAIT_MILLISECONDS + 10)
      expect(await lookup).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  test('F27-AC27: Given an answer with a charset it declares, When looked up, Then the bytes are read as text without failing', async () => {
    const { fetcher } = site({
      'https://example.com/': () => html('<title>café</title>'),
    })
    expect(await title('https://example.com/', fetcher)).toBe('café')
  })
})

const bytesOf = (hex: string) =>
  new Uint8Array(hex.match(/../g)!.map((pair) => parseInt(pair, 16)))
const asHtml = (body: Uint8Array, type = 'text/html') =>
  new Response(body as unknown as BodyInit, {
    headers: { 'content-type': type },
  })
const ascii = (text: string) => new TextEncoder().encode(text)
const join = (...parts: Uint8Array[]) =>
  Uint8Array.from(parts.flatMap((part) => [...part]))
// 日本語, as each legacy charset writes it.
const NIHONGO = {
  shiftJis: '93fa967b8cea',
  eucJp: 'c6fccbdcb8ec',
  iso2022Jp: '1b2442467c4b5c386c1b2842',
}

describe('fetchLinkTitle, the charset of the page', () => {
  test.each([
    ['Shift_JIS', NIHONGO.shiftJis],
    ['EUC-JP', NIHONGO.eucJp],
    ['ISO-2022-JP', NIHONGO.iso2022Jp],
  ])(
    'F27-AC27: Given a Content-Type of %s, When looked up, Then the Japanese title is read right',
    async (label, hex) => {
      const body = join(ascii('<title>'), bytesOf(hex), ascii('</title>'))
      const { fetcher } = site({
        'https://example.com/': () =>
          asHtml(body, `text/html; charset=${label}`),
      })
      expect(await title('https://example.com/', fetcher)).toBe('日本語')
    },
  )

  test.each([
    ['<meta charset="shift_jis">', NIHONGO.shiftJis],
    [
      '<meta http-equiv="Content-Type" content="text/html; charset=EUC-JP">',
      NIHONGO.eucJp,
    ],
  ])(
    'F27-AC27: Given no charset in the header and %s, When looked up, Then the Japanese title is read right',
    async (meta, hex) => {
      const body = join(
        ascii(`${meta}<title>`),
        bytesOf(hex),
        ascii('</title>'),
      )
      const { fetcher } = site({ 'https://example.com/': () => asHtml(body) })
      expect(await title('https://example.com/', fetcher)).toBe('日本語')
    },
  )

  test('F27-AC27: Given a charset that is not known, When looked up, Then the page is read as UTF-8', async () => {
    const { fetcher } = site({
      'https://example.com/': () =>
        asHtml(
          ascii('<title>発表</title>'),
          'text/html; charset=no-such-charset',
        ),
    })
    expect(await title('https://example.com/', fetcher)).toBe('発表')
  })

  test('F27-AC28: Given Shift_JIS bytes read as UTF-8, When looked up, Then the title with U+FFFD is refused, not kept', async () => {
    const body = join(
      ascii('<title>'),
      bytesOf(NIHONGO.shiftJis),
      ascii('</title>'),
    )
    const { fetcher } = site({ 'https://example.com/': () => asHtml(body) })
    expect(await title('https://example.com/', fetcher)).toBeNull()
  })

  test('F27-AC27: Given a character cut in two by the limit, When looked up, Then the cut end does not spoil the title', async () => {
    const early = ascii('<title>Early</title>')
    const filler = ascii('x'.repeat(MAX_PAGE_BYTES - early.length - 1))
    // The 3-byte character starts on the last byte that is read.
    const body = join(early, filler, ascii('あ'))
    const { fetcher } = site({ 'https://example.com/': () => asHtml(body) })
    expect(await title('https://example.com/', fetcher)).toBe('Early')
    const cut = join(
      ascii('<title>'),
      ascii('x'.repeat(MAX_PAGE_BYTES - 8)),
      ascii('あ'),
      ascii('</title>'),
    )
    const two = site({ 'https://example.com/': () => asHtml(cut) })
    // The title is not closed within the limit, so there is none, and no error.
    expect(await title('https://example.com/', two.fetcher)).toBeNull()
  })

  test('F27-AC27: Given a body that never ends and ignores the signal, When looked up, Then it gives up after the time allowed and cancels the read', async () => {
    vi.useFakeTimers()
    try {
      let cancelled = false
      const stalling = vi.fn(async () => {
        const body = new ReadableStream<Uint8Array>({
          pull: () => new Promise(() => undefined),
          cancel() {
            cancelled = true
          },
        })
        return new Response(body, { headers: { 'content-type': 'text/html' } })
      }) as unknown as typeof fetch
      const lookup = title('https://example.com/', stalling)
      await vi.advanceTimersByTimeAsync(WAIT_MILLISECONDS + 10)
      expect(await lookup).toBeNull()
      expect(cancelled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
