// The address an agent fetches one stored file from (D-38). The value in the
// address is the only credential: no cookie and no token are read. Every
// failure is an empty 404, so nothing tells a wrong value from another
// author's file or a connection that is gone; only a value this service
// signed can learn that it has run out (410). The value and the address are
// never logged: nothing here writes a log, and the app's error log names
// this route by its pattern. See docs/dev/f35-agent-export.md.
import { Hono, type Context } from 'hono'
import { authSecret } from '../auth/config'
import { readVersionFile } from '../exports/deck-export-store'
import { downloadHeaders } from '../exports/download-headers'
import { readVersionObject } from '../exports/zip-source-store'
import { withinLimit } from '../site/rate-limit'
import { RETRY_AFTER_SECONDS } from '../site/rate-limit-policy'
import { readLiveGrant } from './access-store'
import { fileUrlKey, FILES_PATH, openFileUrl } from './file-url'
import { mayAct } from './may-act-store'
import { canExport } from './scope'

const now = () => Math.floor(Date.now() / 1000)
const NO_STORE = { 'Cache-Control': 'no-store' }
const gone = () => new Response(null, { status: 404, headers: NO_STORE })

/** Where the files of the author's slides are fetched from, by signed value. */
export const fileRoutes = new Hono<{ Bindings: Env }>()

type C = Context<{ Bindings: Env }>

async function serve(c: C): Promise<Response> {
  if (c.req.method !== 'GET')
    return c.body(null, 405, { ...NO_STORE, Allow: 'GET' })
  // One request a file, so the budget is the one uploads have.
  if (!(await withinLimit(c.env, 'uploads', c.req.raw)))
    return c.body(null, 429, {
      ...NO_STORE,
      'Retry-After': String(RETRY_AFTER_SECONDS),
    })
  const secret = authSecret(c.env)
  if (!secret) return gone()
  const at = now()
  const opened = await openFileUrl(
    await fileUrlKey(secret),
    c.req.param('value') ?? '',
    at,
  )
  if (opened.kind === 'invalid') return gone()
  if (opened.kind === 'expired')
    return c.json(
      {
        error: 'expired',
        message:
          'This address has run out (they last an hour). Call get_slide_files again for new ones.',
      },
      410,
      NO_STORE,
    )
  const { claims } = opened
  // The connection must still be there and allowed to read data out, and
  // its author still allowed to act: ending the connection or suspending
  // the author stops every address already made.
  const grant = await readLiveGrant(c.env.DB, claims.grantId, at)
  if (!grant || !canExport(grant.scopes)) return gone()
  if (!(await mayAct(c.env.DB, grant.ownerUserId))) return gone()
  // The author is the grant's, whatever else the value says: a file of
  // another author's is no row.
  const file = await readVersionFile(c.env.DB, {
    ownerUserId: grant.ownerUserId,
    deploymentId: claims.deploymentId,
    fileId: claims.fileId,
  })
  if (!file) return gone()
  const object = await readVersionObject(
    c.env.UPLOADS,
    claims.deploymentId,
    file.objectKey,
  )
  if (!object) return gone()
  return new Response(object.body, {
    // Never the type it was put up with: a page of the author's own must
    // not be shown as a page of this service.
    headers: downloadHeaders({
      contentType: 'application/octet-stream',
      fileName: 'file',
      length: object.size,
    }),
  })
}

fileRoutes.all(`${FILES_PATH}/:value`, async (c) => {
  try {
    return await serve(c)
  } catch (error) {
    // The app's own error handler would name the path, and the path is the
    // credential. This names the kind of error only.
    console.error(
      JSON.stringify({
        event: 'export_file_error',
        name: error instanceof Error ? error.name : 'unknown',
      }),
    )
    return c.body(null, 500, NO_STORE)
  }
})
