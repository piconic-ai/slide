import { HTTPException } from 'hono/http-exception'
import type { DeckId, DeckSlug } from '../decks/binding'
import { startUpload, uploadsApi } from '../uploads/api'
import type { UploadInventory } from '../uploads/inventory'
import { attemptSchema } from '../uploads/start-request'
import { MCP_PATH } from './oauth-metadata'
import { uploadRefusal, type UploadRefusal } from './refusal'

/** What receiving needs of the request a tool serves. */
export type ReceiveScope = Readonly<{ env: Env; ownerUserId: string }>
type Started = Awaited<ReturnType<typeof startUpload>>
type Outcome<T> =
  | (Readonly<{ ok: true }> & T)
  | Readonly<{ ok: false; refusal: UploadRefusal }>

const FAILED: UploadRefusal = {
  code: 'upload_failed',
  message: 'The upload did not go through; try again.',
}

/** What the start threw, read as a refusal; rethrown when it is none. */
function refusalOfThrown(error: unknown): UploadRefusal {
  const thrown = error as { code?: unknown; details?: unknown }
  const refusal =
    error instanceof HTTPException
      ? uploadRefusal({
          status: error.status,
          message: error.message,
          code: thrown.code,
          details: thrown.details,
        })
      : null
  if (!refusal) throw error
  return refusal
}

/**
 * Starts receiving a new version of the owner's slide, as sent by an agent.
 * The start itself checks that the owner owns the slide, is a registered
 * author and is not suspended, and applies the limits a browser's upload
 * gets.
 */
export async function startVersion(
  { env, ownerUserId }: ReceiveScope,
  deck: Readonly<{ id: DeckId; slug: DeckSlug }>,
  inventory: UploadInventory,
): Promise<Outcome<{ started: Started }>> {
  try {
    const started = await startUpload(
      { env, req: { url: new URL(MCP_PATH, env.PUBLIC_ORIGIN).href } },
      {
        ownerUserId,
        source: 'mcp',
        deck,
        attempt: attemptSchema.parse(crypto.randomUUID()),
        inventory,
      },
    )
    return { ok: true, started }
  } catch (error) {
    return { ok: false, refusal: refusalOfThrown(error) }
  }
}

/** The refusal an upload route answered with, or null when it accepted. */
async function refusalOf(response: Response): Promise<UploadRefusal | null> {
  if (response.ok) return null
  const body: unknown = await response.json().catch(() => null)
  const fields = (body ?? {}) as { error?: unknown; code?: unknown }
  return (
    uploadRefusal({
      status: response.status,
      message: typeof fields.error === 'string' ? fields.error : FAILED.message,
      code: fields.code,
      details: body,
    }) ?? FAILED
  )
}

/**
 * Asks the upload routes to finalize, with the upload's own credential.
 * The routes are called inside the Worker, not over the network, so every
 * check they make on a browser's upload is made here too.
 */
export async function finalizeUpload(
  env: Env,
  uploadId: string,
  credential: string,
): Promise<Outcome<{ uploadId: string }>> {
  const response = await uploadsApi.request(
    `/${encodeURIComponent(uploadId)}/finalize`,
    { method: 'POST', headers: { Authorization: `Bearer ${credential}` } },
    env,
  )
  const refusal = await refusalOf(response)
  return refusal ? { ok: false, refusal } : { ok: true, uploadId }
}

/**
 * Sends the bytes of every file the started upload still lacks, then
 * finalizes it.
 */
export async function sendAndFinalize(
  env: Env,
  started: Started,
  bytes: ReadonlyMap<string, Uint8Array<ArrayBuffer>>,
): Promise<Outcome<{ uploadId: string }>> {
  for (const file of started.files) {
    const body = bytes.get(file.path)
    if (file.received) continue
    if (!body) return { ok: false, refusal: FAILED }
    const response = await uploadsApi.request(
      `/${started.deploymentId}/files/${file.id}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${started.credential}` },
        body,
      },
      env,
    )
    const refusal = await refusalOf(response)
    if (refusal) return { ok: false, refusal }
  }
  return finalizeUpload(env, started.deploymentId, started.credential)
}
