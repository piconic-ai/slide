import { contentBaseOf } from '../preview/config'
import { deploymentOrigin } from '../preview/origin'
import { isPublicDeployment } from '../share/store'
import {
  FAILED_SHOT_HEADERS,
  isJpegShot,
  NO_STORE_HEADERS,
  parseCoverShotUrl,
  shotHeaders,
  shotOptions,
} from './shot'

const failed = () =>
  new Response(null, { status: 503, headers: FAILED_SHOT_HEADERS })
const notFound = () =>
  new Response(null, { status: 404, headers: NO_STORE_HEADERS })

/**
 * Takes the cover of one deployment for the internal cache: its deck's first
 * slide, as a browser draws it. Callers have already checked that anyone may
 * see the deployment.
 */
export async function takeCoverShot(
  env: Env,
  request: Request,
): Promise<Response> {
  const deploymentId =
    request.method === 'GET' ? parseCoverShotUrl(request.url) : null
  const base = contentBaseOf(env)
  if (!deploymentId || !base || !env.BROWSER) return notFound()
  let shot: Response
  try {
    shot = await env.BROWSER.quickAction(
      'screenshot',
      shotOptions(`${deploymentOrigin(base, deploymentId)}/`),
    )
  } catch {
    return failed()
  }
  if (!isJpegShot(shot.ok, shot.headers.get('Content-Type'))) {
    await shot.body?.cancel()
    return failed()
  }
  // A deck stopped or replaced while the browser was open answered it with
  // an error page; that picture must not be kept as the deployment's cover.
  if (!(await isPublicDeployment(env.DB, deploymentId))) {
    await shot.body?.cancel()
    return notFound()
  }
  return new Response(shot.body, { headers: shotHeaders(deploymentId) })
}
