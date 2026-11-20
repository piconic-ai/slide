import type { Browser, Page } from 'playwright'
import server from '../../server'
import { TEST_ORIGIN } from '../publication/test-support'

export type Exchange = Readonly<{
  method: string
  path: string
  status: number
}>

/**
 * A page of the service with its requests answered by the Worker, for tests
 * of the drop zone. The session cookie is HttpOnly and host-bound, so it is
 * added to each request instead of the browser's jar. Every exchange with
 * the service is noted. `hold` keeps a request waiting until the test lets
 * it go, to look at the page meanwhile.
 */
export async function openPage(
  browser: Browser,
  env: Env,
  path: string,
  options: Readonly<{
    cookie?: string
    lang?: string
    hold?: (method: string, path: string) => Promise<void> | void
    /** Answers 503 in place of the Worker while it returns true. */
    down?: (method: string, path: string) => boolean
    /** The host of the content origin, for a test that opens the slides. */
    contentHost?: string
  }> = {},
): Promise<{ page: Page; exchanges: Exchange[]; errors: string[] }> {
  const context = await browser.newContext({ locale: options.lang ?? 'ja-JP' })
  const page = await context.newPage()
  const exchanges: Exchange[] = []
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    // The origin the slides themselves are served from, when one is set.
    const content =
      options.contentHost !== undefined &&
      (url.hostname === options.contentHost ||
        url.hostname.endsWith(`.${options.contentHost}`))
    if (url.origin !== TEST_ORIGIN && !content) return route.abort()
    const method = request.method()
    await options.hold?.(method, url.pathname)
    if (options.down?.(method, url.pathname)) {
      exchanges.push({ method, path: url.pathname, status: 503 })
      return route.fulfill({ status: 503, body: '' })
    }
    const headers = await request.allHeaders()
    // Miniflare's asset proxy refuses an Origin outside its own hostnames,
    // which module scripts send; the service itself reads it on a POST.
    if (method === 'GET') delete headers.origin
    else headers.origin = TEST_ORIGIN
    if (options.cookie && !content) headers.cookie = options.cookie
    const response = await server.fetch(
      new Request(url, {
        method,
        headers,
        body: (request.postDataBuffer() ?? undefined) as BodyInit | undefined,
        redirect: 'manual',
      }),
      env,
    )
    if (url.pathname.startsWith('/api/') || response.status >= 400)
      exchanges.push({ method, path: url.pathname, status: response.status })
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  await page.goto(`${TEST_ORIGIN}${path}`)
  return { page, exchanges, errors }
}

/** Drops files on an element, as dragging them from the desktop does. */
export async function dropFiles(
  page: Page,
  selector: string,
  files: readonly Readonly<{ name: string; type: string; text: string }>[],
) {
  const transfer = await page.evaluateHandle((dropped) => {
    const data = new DataTransfer()
    for (const { name, type, text } of dropped)
      data.items.add(new File([text], name, { type }))
    return data
  }, files)
  await page.dispatchEvent(selector, 'dragenter', { dataTransfer: transfer })
  await page.dispatchEvent(selector, 'dragover', { dataTransfer: transfer })
  await page.dispatchEvent(selector, 'drop', { dataTransfer: transfer })
}
