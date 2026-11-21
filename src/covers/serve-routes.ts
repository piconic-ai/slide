import puppeteer from '@cloudflare/puppeteer'
import { contentBaseOf } from '../preview/config'
import { deploymentOrigin } from '../preview/origin'
import { isPublicDeployment } from '../share/store'
import {
  BROWSER_BUSY_HEADERS,
  CLOSE_DEADLINE_MS,
  FAILED_SHOT_HEADERS,
  NO_STORE_HEADERS,
  OVER_BUDGET_HEADERS,
  pageShotBudgetKey,
  parseShotUrl,
  shotHeaders,
  shotLocation,
  SHOT_DEADLINE_MS,
  shotOptions,
  type ShotTarget,
} from './shot'

/** Rejects when the browser has not answered in time. */
function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('shot timed out')), ms)
  })
  return Promise.race([work, expired]).finally(() => clearTimeout(timer))
}

type Browser = Awaited<ReturnType<typeof puppeteer.launch>>

/**
 * Draws a page in an open browser and returns the JPEG. Dialogs the deck
 * opens are dismissed, so none waits for an answer no one gives.
 */
async function drawShot(
  browser: Browser,
  options: ReturnType<typeof shotOptions>,
): Promise<Uint8Array<ArrayBuffer>> {
  const page = await browser.newPage()
  page.on('dialog', (dialog) => void dialog.dismiss().catch(() => {}))
  await page.setViewport(options.viewport)
  await page.goto(options.url, options.gotoOptions)
  return (await page.screenshot(
    options.screenshotOptions,
  )) as Uint8Array<ArrayBuffer>
}

/**
 * Closes the browser, which ends its session and every page, popup and
 * download the deck opened. A close that fails or hangs is only recorded:
 * the picture already taken, or the failure already known, stands.
 */
async function closeBrowser(browser: Browser) {
  try {
    await within(browser.close(), CLOSE_DEADLINE_MS)
  } catch (error) {
    console.warn('The browser did not close cleanly', error)
  }
}

/**
 * Opens a browser of the binding, takes the image, and always closes the
 * browser. `null` when the browser opened but took no image; rejects when
 * it could not be opened.
 */
async function takeWithBrowser(
  binding: Env['BROWSER'],
  options: ReturnType<typeof shotOptions>,
): Promise<Uint8Array<ArrayBuffer> | null> {
  // The binding is what puppeteer drives; its type lacks `connect`, which
  // puppeteer's declaration asks for but never calls.
  const browser = await puppeteer.launch(
    binding as unknown as Parameters<typeof puppeteer.launch>[0],
  )
  try {
    return await within(drawShot(browser, options), SHOT_DEADLINE_MS)
  } catch {
    return null
  } finally {
    await closeBrowser(browser)
  }
}

const browserBusy = () =>
  new Response(null, { status: 503, headers: BROWSER_BUSY_HEADERS })
const failed = () =>
  new Response(null, { status: 503, headers: FAILED_SHOT_HEADERS })
const notFound = () =>
  new Response(null, { status: 404, headers: NO_STORE_HEADERS })

const overBudget = () =>
  new Response(null, { status: 503, headers: OVER_BUDGET_HEADERS })

/**
 * Whether the browser may be started for the target now. This runs only
 * when the internal cache has no answer, so images already taken, and
 * failures still remembered, do not count. The cover is not counted: a
 * deployment has one, and its failure is remembered for a minute.
 */
async function withinShotBudget(env: Env, target: ShotTarget) {
  if (target.kind === 'cover') return true
  const { success } = await env.PAGE_SHOT_RATE_LIMITER.limit({
    key: pageShotBudgetKey(target.deploymentId),
  })
  return success
}

/**
 * Takes one image for the internal cache: a deck's first slide or one of
 * its pages, as a browser draws it. Callers have already checked that
 * anyone may see the deployment, and for a page that its deck pages by
 * number.
 */
export async function takeCoverShot(
  env: Env,
  request: Request,
): Promise<Response> {
  const target = request.method === 'GET' ? parseShotUrl(request.url) : null
  const base = contentBaseOf(env)
  if (!target || !base || !env.BROWSER) return notFound()
  if (!(await withinShotBudget(env, target))) return overBudget()
  const { deploymentId } = target
  let shot: Uint8Array<ArrayBuffer> | null
  try {
    shot = await takeWithBrowser(
      env.BROWSER,
      shotOptions(
        `${deploymentOrigin(base, deploymentId)}${shotLocation(target)}`,
      ),
    )
  } catch {
    return browserBusy()
  }
  if (!shot || shot.byteLength === 0) return failed()
  // A deck stopped or replaced while the browser was open answered it with
  // an error page; that picture must not be kept as the deployment's image.
  if (!(await isPublicDeployment(env.DB, deploymentId))) {
    return notFound()
  }
  return new Response(shot, { headers: shotHeaders(deploymentId) })
}
