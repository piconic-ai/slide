import { contentBaseOf } from '../preview/config'
import { deploymentOrigin } from '../preview/origin'
import { parseCoverShotUrl, shotOptions } from './shot'

const noStore = { 'Cache-Control': 'no-store' }

/**
 * Takes the cover of one deployment for the internal cache: its deck's first
 * slide, as a browser draws it. Callers have already checked that anyone may
 * see the deployment. Failures are not cached, so the next request tries
 * again.
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
    return new Response(null, { status: 502, headers: noStore })
  }
  if (!shot.ok || !shot.headers.get('Content-Type')?.startsWith('image/')) {
    await shot.body?.cancel()
    // Over the browser budget, or a deck that did not load in time.
    return new Response(null, {
      status: shot.status === 429 ? 503 : 502,
      headers: noStore,
    })
  }
  return new Response(shot.body, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Cache-Tag': `deployment-${deploymentId}`,
    },
  })
}
