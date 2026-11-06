import { WorkerEntrypoint } from 'cloudflare:workers'
import server from './server'
import { serveStoredFile } from './src/preview/stored-file'

/**
 * Stored bytes behind Workers Cache. Only the gateway in server.tsx calls it,
 * through ctx.exports after authorizing the request; a named entrypoint has
 * no route of its own, so readers cannot reach it.
 */
export class ContentFiles extends WorkerEntrypoint<Env> {
  override fetch(request: Request) {
    return serveStoredFile(this.env.UPLOADS, request)
  }
}

export default server
