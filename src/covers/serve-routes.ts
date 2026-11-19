import { contentBaseOf } from '../preview/config'
import { deploymentOrigin } from '../preview/origin'
import { isPublicDeployment } from '../share/store'
import {
  FAILED_SHOT_HEADERS,
  isJpegShot,
  NO_STORE_HEADERS,
  parseShotUrl,
  shotHeaders,
  shotLocation,
  shotOptions,
} from './shot'

const failed = () =>
  new Response(null, { status: 503, headers: FAILED_SHOT_HEADERS })
const notFound = () =>
  new Response(null, { status: 404, headers: NO_STORE_HEADERS })

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
  const { deploymentId } = target
  let shot: Response
  try {
    shot = await env.BROWSER.quickAction(
      'screenshot',
      shotOptions(
        `${deploymentOrigin(base, deploymentId)}${shotLocation(target)}`,
      ),
    )
  } catch {
    return failed()
  }
  if (!isJpegShot(shot.ok, shot.headers.get('Content-Type'))) {
    await shot.body?.cancel()
    return failed()
  }
  // A deck stopped or replaced while the browser was open answered it with
  // an error page; that picture must not be kept as the deployment's image.
  if (!(await isPublicDeployment(env.DB, deploymentId))) {
    await shot.body?.cancel()
    return notFound()
  }
  return new Response(shot.body, { headers: shotHeaders(deploymentId) })
}
