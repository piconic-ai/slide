import { WorkerEntrypoint } from 'cloudflare:workers'
import server from './src/app/routes'
import { takeCoverShot } from './src/covers/serve-routes'
import { serveStoredFile } from './src/preview/stored-file'

/**
 * Stored bytes behind Workers Cache. Only the gateway in src/app/routes.tsx calls it,
 * through ctx.exports after authorizing the request; a named entrypoint has
 * no route of its own, so readers cannot reach it.
 */
export class ContentFiles extends WorkerEntrypoint<Env> {
  override fetch(request: Request) {
    return serveStoredFile(this.env.UPLOADS, request)
  }
}

/**
 * Generated covers behind Workers Cache. Only the cover route calls it,
 * through ctx.exports after checking that the deployment is public.
 */
export class CoverShots extends WorkerEntrypoint<Env> {
  override fetch(request: Request) {
    return takeCoverShot(this.env, request)
  }
}

export default server
