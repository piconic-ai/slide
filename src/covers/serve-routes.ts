import puppeteer from '@cloudflare/puppeteer'
import { contentBaseOf } from '../preview/config'
import { deploymentOrigin } from '../preview/origin'
import { isPublicDeployment } from '../share/store'
import {
  FAILED_SHOT_HEADERS,
  NO_STORE_HEADERS,
  OVER_BUDGET_HEADERS,
  pageShotBudgetKey,
  parseShotUrl,
  shotHeaders,
  shotLocation,
  shotOptions,
  type ShotTarget,
} from './shot'

/**
 * Draws a page in a browser of the binding and returns the JPEG. The browser
 * is closed whether the shot succeeds or not, so no session outlives it. Any
 * failure to open, load or draw rejects.
 */
async function drawShot(
  binding: Env['BROWSER'],
  options: ReturnType<typeof shotOptions>,
): Promise<Uint8Array<ArrayBuffer>> {
  // The binding is what puppeteer drives; its type lacks `connect`, which
  // puppeteer's declaration asks for but never calls.
  const browser = await puppeteer.launch(
    binding as unknown as Parameters<typeof puppeteer.launch>[0],
  )
  try {
    const page = await browser.newPage()
    await page.setViewport(options.viewport)
    await page.goto(options.url, options.gotoOptions)
    return (await page.screenshot(
      options.screenshotOptions,
    )) as Uint8Array<ArrayBuffer>
  } finally {
    await browser.close()
  }
}

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
  let shot: Uint8Array<ArrayBuffer>
  try {
    shot = await drawShot(
      env.BROWSER,
      shotOptions(
        `${deploymentOrigin(base, deploymentId)}${shotLocation(target)}`,
      ),
    )
  } catch {
    return failed()
  }
  if (shot.byteLength === 0) return failed()
  // A deck stopped or replaced while the browser was open answered it with
  // an error page; that picture must not be kept as the deployment's image.
  if (!(await isPublicDeployment(env.DB, deploymentId))) {
    return notFound()
  }
  return new Response(shot, { headers: shotHeaders(deploymentId) })
}
