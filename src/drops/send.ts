import type { PlannedFile } from './plan'

/** What a request to the service answered: its status and its JSON, if any. */
export type Answer = Readonly<{ status: number; body: unknown }>
/** Sends one request to the service. Injected, so the flow has no I/O of its own. */
export type SendRequest = (
  path: string,
  init: Readonly<{
    method: 'GET' | 'POST' | 'PUT'
    headers?: Readonly<Record<string, string>>
    body?: string | Uint8Array
  }>,
) => Promise<Answer>

/** Where a drop goes: a new slide, or a new version of the author's slide. */
export type DropTarget =
  | Readonly<{ kind: 'new' }>
  | Readonly<{ kind: 'version'; slug: string }>

export type SendFailure =
  /** Nobody is signed in. */
  | 'sign_in'
  /** Signed in, but not registered as an author. */
  | 'invitation_only'
  /** The author has as many slides as one account may hold. */
  | 'deck_limit'
  /** The service refused the version for a limit; `limit` names it. */
  | 'limit'
  /** The slide is not there, or not the author's. */
  | 'not_found'
  /** The account is suspended, or the slide takes no uploads. */
  | 'refused'
  /** The service does not take these files, such as a path it forbids. */
  | 'invalid'
  /** Another upload of the author is receiving a file right now. */
  | 'busy'
  /** It did not finish; trying again may work. */
  | 'failed'

export type SendResult =
  | Readonly<{ ok: true; manageUrl: string; viewUrl: string; slug: string }>
  | Readonly<{
      ok: false
      reason: SendFailure
      limit?: string
      /**
       * Whether sending the same files under the same attempt may still
       * finish this upload. False once the service refused the start for a
       * reason of its own, or closed the upload.
       */
      resumable: boolean
    }>

export type SendInput = Readonly<{
  request: SendRequest
  /** Waits before a retry. Injected, so tests need no real time. */
  wait: (milliseconds: number) => Promise<void>
  target: DropTarget
  /** Names this drop; every retry of it uses the same one. */
  attempt: string
  name: Readonly<{ title?: string; fileName?: string }>
  files: readonly PlannedFile[]
  /** Called as files are received: how many of how many. */
  onProgress?: (received: number, total: number) => void
}>

/** How often the whole exchange starts over: an expired credential, files to resend. */
const MAX_ROUNDS = 4
/** How often one request is tried when the answer says to try again. */
const MAX_TRIES = 5
const FIRST_WAIT = 500

type Json = Readonly<Record<string, unknown>>
const json = (body: unknown): Json =>
  typeof body === 'object' && body !== null ? (body as Json) : {}
const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** An answer that may be different when the same request is sent again. */
const isTransient = ({ status, body }: Answer) =>
  status === 429 ||
  status >= 500 ||
  (status === 409 &&
    (json(body).code === undefined || json(body).code === 'session_changed'))

async function withRetry(
  input: SendInput,
  send: () => Promise<Answer>,
): Promise<Answer> {
  for (let attempt = 1; ; attempt++) {
    const answer = await send().catch(
      // The network failed; the request may not have arrived.
      (): Answer => ({ status: 503, body: null }),
    )
    if (!isTransient(answer) || attempt >= MAX_TRIES) return answer
    await input.wait(FIRST_WAIT * 2 ** (attempt - 1))
  }
}

const startPath = (target: DropTarget) =>
  target.kind === 'new'
    ? '/api/slides'
    : `/api/slides/${encodeURIComponent(target.slug)}/uploads`

function start(input: SendInput): Promise<Answer> {
  return withRetry(input, () =>
    input.request(startPath(input.target), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attempt: input.attempt,
        name: input.name,
        entry: 'index.html',
        files: input.files.map(({ path, size, sha256 }) => ({
          path,
          size,
          sha256,
        })),
      }),
    }),
  )
}

const refusals: Readonly<Record<number, SendFailure>> = {
  400: 'invalid',
  401: 'sign_in',
  403: 'refused',
  404: 'not_found',
  429: 'busy',
}
const codes: Readonly<Record<string, SendFailure>> = {
  invitation_only: 'invitation_only',
  deck_limit: 'deck_limit',
  start_rejected: 'limit',
  upload_busy: 'busy',
}

/** Answers that say the upload of an attempt is over; a new attempt is needed. */
const CLOSED: ReadonlySet<unknown> = new Set([
  'session_expired',
  'session_failed',
  'inventory_conflict',
])

/** Why a start that did not answer 201 was refused. */
function startFailure({ status, body }: Answer): SendResult {
  const code = text(json(body).code)
  const reason = codes[code] ?? refusals[status] ?? 'failed'
  const limit = text(json(body).reason)
  // Only an upload that merely did not get through can be picked up again.
  const resumable =
    reason === 'busy' || (reason === 'failed' && !CLOSED.has(code))
  return reason === 'limit' && limit
    ? { ok: false, reason, limit, resumable }
    : { ok: false, reason, resumable }
}

type Session = Readonly<{
  id: string
  credential: string
  manageUrl: string
  /** The author's viewer of the slides; empty when the service named none. */
  viewUrl: string
  slug: string
  /** The file IDs the service gave, by path, for those not received yet. */
  missing: ReadonlyMap<string, string>
}>

/** Reads the receipt of a start; null when it is not what a start answers. */
function sessionOf(body: unknown): Session | null {
  const receipt = json(body)
  const id = text(receipt.deploymentId)
  const credential = text(receipt.credential)
  const manageUrl = text(receipt.manageUrl)
  if (!id || !credential || !manageUrl || !Array.isArray(receipt.files))
    return null
  const missing = new Map<string, string>()
  for (const file of receipt.files.map(json))
    if (file.received !== true) missing.set(text(file.path), text(file.id))
  return {
    id,
    credential,
    manageUrl,
    viewUrl: text(receipt.viewUrl),
    slug: text(receipt.slug),
    missing,
  }
}

type Step = 'done' | 'again' | 'failed' | 'closed'

/** What an answer other than success means for the exchange. */
function stepAfter(answer: Answer): Step {
  const code = json(answer.body).code
  if (CLOSED.has(code)) return 'closed'
  // A fresh start renews an expired credential and lists files to resend.
  return code === 'credential_expired' || code === 'files_missing'
    ? 'again'
    : 'failed'
}

/** Sends the files the service has not received, then finalizes. */
async function sendFiles(input: SendInput, session: Session): Promise<Step> {
  const auth = { Authorization: `Bearer ${session.credential}` }
  const total = input.files.length
  let received = total - session.missing.size
  input.onProgress?.(received, total)
  for (const file of input.files) {
    const fileId = session.missing.get(file.path)
    if (fileId === undefined) continue
    const answer = await withRetry(input, () =>
      input.request(`/api/uploads/${session.id}/files/${fileId}`, {
        method: 'PUT',
        headers: auth,
        body: file.bytes,
      }),
    )
    if (answer.status !== 200) return stepAfter(answer)
    received += 1
    input.onProgress?.(received, total)
  }
  const answer = await withRetry(input, () =>
    input.request(`/api/uploads/${session.id}/finalize`, {
      method: 'POST',
      headers: auth,
    }),
  )
  return answer.status === 200 && json(answer.body).state === 'ready'
    ? 'done'
    : stepAfter(answer)
}

/**
 * Sends one drop: starts the upload, sends each file the service has not
 * received, and finalizes. Whatever fails halfway, the same attempt is
 * started again, which continues the same upload: an expired credential is
 * renewed and only the files still missing are sent.
 */
export async function sendDrop(input: SendInput): Promise<SendResult> {
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const started = await start(input)
    if (started.status !== 201) return startFailure(started)
    const session = sessionOf(started.body)
    if (!session) return { ok: false, reason: 'failed', resumable: true }
    const step = await sendFiles(input, session)
    if (step === 'done')
      return {
        ok: true,
        manageUrl: session.manageUrl,
        viewUrl: session.viewUrl,
        slug: session.slug,
      }
    if (step !== 'again')
      return { ok: false, reason: 'failed', resumable: step === 'failed' }
  }
  return { ok: false, reason: 'failed', resumable: true }
}
