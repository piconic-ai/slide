import { fetchTarget, isRedirectStatus, MAX_REDIRECTS } from './title-policy'
import { MAX_PAGE_BYTES, titleOfPage } from './title-parse'

/** How long the whole of one lookup may take, redirects and reading included. */
export const WAIT_MILLISECONDS = 3000
const USER_AGENT = 'slide-link-title/1.0'

/** The text of a response's first `MAX_PAGE_BYTES`; the rest is not read. */
async function readHead(response: Response): Promise<string | null> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (size < MAX_PAGE_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.byteLength
    }
  } finally {
    // Whatever is left of a long page is dropped, not downloaded.
    await reader.cancel().catch(() => undefined)
  }
  const bytes = new Uint8Array(Math.min(size, MAX_PAGE_BYTES))
  let offset = 0
  for (const chunk of chunks) {
    const room = bytes.length - offset
    if (room <= 0) break
    bytes.set(chunk.subarray(0, room), offset)
    offset += Math.min(chunk.byteLength, room)
  }
  return new TextDecoder().decode(bytes)
}

const isHtml = (response: Response) =>
  /^text\/html\b/iu.test(response.headers.get('content-type') ?? '')

/** What one request came to: a title (or none), or a redirect to follow. */
type Step =
  | Readonly<{ kind: 'done'; title: string | null }>
  | Readonly<{ kind: 'redirect'; location: string | null }>

const drop = (response: Response) =>
  response.body?.cancel().catch(() => undefined)

/** Asks one address once, as a visitor without cookies would. */
async function askOnce(
  target: URL,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<Step> {
  const response = await fetcher(target.href, {
    method: 'GET',
    redirect: 'manual',
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    headers: { Accept: 'text/html', 'User-Agent': USER_AGENT },
  })
  if (isRedirectStatus(response.status)) {
    await drop(response)
    return { kind: 'redirect', location: response.headers.get('location') }
  }
  if (response.status !== 200 || !isHtml(response)) {
    await drop(response)
    return { kind: 'done', title: null }
  }
  const head = await readHead(response)
  return { kind: 'done', title: head === null ? null : titleOfPage(head) }
}

/**
 * The title of the page a link leads to, or null: it asks once for the page
 * and reads the start of it. Every way it can fail is null, never an error:
 * an address it must not ask (see `fetchTarget`), no answer within three
 * seconds, a refusal, a page that is not HTML, no title, a title that may not
 * be kept. Redirects are followed by hand, at most three, and each place they
 * lead to is checked as the first address was. `fetcher` is the one place the
 * network is touched.
 */
export async function fetchLinkTitle(
  address: string,
  options: Readonly<{
    ownHosts: readonly string[]
    fetcher?: typeof fetch
  }>,
): Promise<string | null> {
  const fetcher = options.fetcher ?? globalThis.fetch
  try {
    const signal = AbortSignal.timeout(WAIT_MILLISECONDS)
    let current = address
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const target = fetchTarget(current, options.ownHosts)
      if (!target) return null
      const step = await askOnce(target, fetcher, signal)
      if (step.kind === 'done') return step.title
      if (!step.location) return null
      current = new URL(step.location, target).href
    }
    // Another redirect after the last one allowed is not followed.
    return null
  } catch {
    return null
  }
}
