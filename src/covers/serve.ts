import { contentBaseOf } from '../preview/config'
import { deploymentOrigin } from '../preview/origin'
import { isPublicDeployment } from '../share/store'
import { parseCoverShotUrl, shotOptions } from './shot'

const noStore = { 'Cache-Control': 'no-store' }

/**
 * A shot that failed is not taken again for a minute, so a deck that never
 * settles, or a browser over its budget, costs one attempt per minute
 * however often its cover is asked for.
 */
const failed = () =>
  new Response(null, {
    status: 503,
    headers: { 'Cache-Control': 'public, max-age=60' },
  })

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
  if (!deploymentId || !base || !env.BROWSER)
    return new Response(null, { status: 404, headers: noStore })
  let shot: Response
  try {
    shot = await env.BROWSER.quickAction(
      'screenshot',
      shotOptions(`${deploymentOrigin(base, deploymentId)}/`),
    )
  } catch {
    return failed()
  }
  if (!shot.ok || shot.headers.get('Content-Type') !== 'image/jpeg') {
    await shot.body?.cancel()
    return failed()
  }
  // A deck stopped or replaced while the browser was open answered it with
  // an error page; that picture must not be kept as the deployment's cover.
  if (!(await isPublicDeployment(env.DB, deploymentId))) {
    await shot.body?.cancel()
    return new Response(null, { status: 404, headers: noStore })
  }
  return new Response(shot.body, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Cache-Tag': `deployment-${deploymentId}`,
    },
  })
}
