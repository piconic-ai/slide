import { WorkerEntrypoint } from 'cloudflare:workers'
import server from './routes'
import { takeCoverShot } from '../covers/serve-routes'
import { serveFacePicture } from '../profile/face-picture-store'
import { serveStoredFile } from '../preview/stored-file-store'

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

/**
 * Uploaded profile pictures behind Workers Cache. Only the avatar route
 * calls it, through ctx.exports after reading D1 for the current upload.
 */
export class FacePictures extends WorkerEntrypoint<Env> {
  override fetch(request: Request) {
    return serveFacePicture(this.env.UPLOADS, request)
  }
}

export default server
