#!/usr/bin/env node
// Sends a directory of built files as a new version of one of the author's
// slides, the way the browser does: it starts with the author's session
// cookie, then sends each file and finalizes with the credential the start
// returned. For local use and for seeding a local Worker.
//
//   SLIDE_ID=<slug> SLIDE_OWNER_COOKIE='__Host-slide_owner=...' \
//     node scripts/upload.mjs DIRECTORY [SERVICE_URL]
import { createHash, randomUUID } from 'node:crypto'
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import {
  busyStartWait,
  parseRetryDelay,
  scaledBusyStart,
  transientWait,
} from './retry-policy.mjs'

const [directory, endpoint = 'https://slide.community'] = process.argv.slice(2)
if (!directory)
  throw new Error('Usage: node scripts/upload.mjs DIRECTORY [SERVICE_URL]')
const deck = process.env.SLIDE_ID
// The signed-in author, as the browser's cookie header names them.
const ownerCookie = process.env.SLIDE_OWNER_COOKIE
// Names this try; starting again with it continues the same upload.
const attempt = process.env.SLIDE_ATTEMPT || randomUUID()
const credentialFile = process.env.SLIDE_CREDENTIAL_FILE
const reportFile = process.env.SLIDE_REPORT_FILE
const outputPaths = [credentialFile, reportFile]
  .filter(Boolean)
  .map((path) => resolve(path))
if (new Set(outputPaths).size !== outputPaths.length)
  throw new Error('Output files must use different paths')
const origin = new URL(endpoint)
if (
  origin.protocol !== 'https:' &&
  !['localhost', '127.0.0.1'].includes(origin.hostname)
) {
  throw new Error('Service URL must use HTTPS')
}
const root = resolve(directory)
// Files are sent as built: the service puts the page script into the top
// page as it serves it.
const readSent = (path) => readFile(join(root, path))
if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink())
  throw new Error('Upload directory must not be a symlink')
const localFiles = []
async function walk(relative = '') {
  for (const name of (await readdir(join(root, relative))).sort()) {
    const path = relative ? `${relative}/${name}` : name
    const info = await lstat(join(root, path))
    if (info.isSymbolicLink())
      throw new Error(`Symlink is not supported: ${path}`)
    if (info.isDirectory()) {
      await walk(path)
      continue
    }
    if (!info.isFile()) throw new Error(`Not a static file: ${path}`)
    const bytes = await readSent(path)
    localFiles.push({
      path: path.normalize('NFC'),
      localPath: path,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
  }
}
await walk()
// Limits are enforced by the service, which reports the reason for a refusal.
const retryDelay = parseRetryDelay(process.env.SLIDE_RETRY_DELAY_MS)
// Busy-start waits scale with the same delay so tests can shorten them.
const busyStartPolicy = scaledBusyStart(retryDelay)
const MAX_FINALIZE_ROUNDS = 3
const session = {
  credential: process.env.SLIDE_UPLOAD_CREDENTIAL,
  deploymentId: process.env.SLIDE_DEPLOYMENT_ID,
}

// A rate-limited answer says how long to wait; longer waits are capped so a
// bad header cannot stall the job.
const MAX_RETRY_AFTER_MS = 120_000
const retryAfterMs = (value) => {
  const seconds = value?.trim() ? Number(value) : NaN
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
    : null
}

class ServiceError extends Error {
  constructor(status, data, retryAfter = null) {
    super(`Upload request failed (${status}): ${data.error ?? 'Unknown error'}`)
    this.status = status
    this.code = data.code
    this.data = data
    this.retryAfter = retryAfter
  }
}

async function call(path, { token, ...options }) {
  const response = await fetch(new URL(path, origin), {
    ...options,
    headers: token
      ? { ...options.headers, Authorization: `Bearer ${token}` }
      : options.headers,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok)
    throw new ServiceError(
      response.status,
      data,
      retryAfterMs(response.headers.get('Retry-After')),
    )
  return data
}

// Conflicts without a code, busy answers, and server errors may succeed later.
const isTransient = (error) =>
  error instanceof ServiceError &&
  (error.status === 429 ||
    error.status >= 500 ||
    (error.status === 409 && (!error.code || error.code === 'session_changed')))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const isBusy = (error) =>
  error instanceof ServiceError && error.code === 'upload_busy'

async function withRetry(operation, retries = isTransient) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (!retries(error)) throw error
      const wait = transientWait({
        attempt,
        retryAfter: error.retryAfter,
        baseMs: retryDelay,
      })
      if (wait === null) throw error
      await sleep(wait)
    }
  }
}

/**
 * Starts a session, waiting while another upload for the same account holds
 * the only active session.
 */
async function withBusyStartRetry(operation) {
  const started = Date.now()
  for (let attempt = 1; ; attempt++) {
    try {
      return await withRetry(
        operation,
        (error) => isTransient(error) && !isBusy(error),
      )
    } catch (error) {
      if (!isBusy(error)) throw error
      const elapsedMs = Date.now() - started
      const wait = busyStartWait({
        attempt,
        elapsedMs,
        retryAfter: error.retryAfter,
        random: Math.random(),
        policy: busyStartPolicy,
      })
      if (wait === null)
        throw new Error(
          `Upload start stayed busy (upload_busy) after ${Math.round(elapsedMs / 1000)}s: another upload for this account is still running. ` +
            'Run it again after that upload finishes.',
        )
      process.stderr.write(
        `Another upload for this account is in progress; retrying in ${Math.round(wait / 1000)}s\n`,
      )
      await sleep(wait)
    }
  }
}

/** Starts the session, or starts the attempt again to renew its credential. */
async function authenticate() {
  if (!deck || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(deck))
    throw new Error('Set SLIDE_ID to the URL name (slug) of your slide')
  if (!ownerCookie)
    throw new Error(
      'Set SLIDE_OWNER_COOKIE to the signed-in author’s cookie, or supply SLIDE_UPLOAD_CREDENTIAL and SLIDE_DEPLOYMENT_ID to resume',
    )
  const body = JSON.stringify({
    attempt,
    entry: 'index.html',
    files: localFiles.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
  })
  try {
    const started = await withBusyStartRetry(() =>
      call(`/api/slides/${deck}/uploads`, {
        method: 'POST',
        // The service takes a start only from its own origin, as JSON.
        headers: {
          Cookie: ownerCookie,
          Origin: origin.origin,
          'Content-Type': 'application/json',
        },
        body,
      }),
    )
    session.credential = started.credential
    session.deploymentId = started.deploymentId
    session.manageUrl = started.manageUrl
  } catch (error) {
    throw explainRefusal(error)
  }
}

function explainRefusal(error) {
  if (!(error instanceof ServiceError) || !error.data.reason) return error
  return new Error(
    `Upload refused (${error.data.reason}): ${error.data.error}. Check the upload history for details.`,
  )
}

/** Calls the session API, renewing an expired credential when possible. */
async function sessionCall(path, options = {}) {
  try {
    return await withRetry(() =>
      call(path, { ...options, token: session.credential }),
    )
  } catch (error) {
    if (!(error instanceof ServiceError) || error.code !== 'credential_expired')
      throw explainRefusal(error)
    await authenticate()
    return withRetry(() =>
      call(path, { ...options, token: session.credential }),
    )
  }
}

async function sendMissingFiles() {
  const status = await sessionCall(`/api/uploads/${session.deploymentId}`)
  if (status.files.length !== localFiles.length)
    throw new Error('Local directory differs from upload session')
  for (const file of status.files) {
    const local = localFiles.find((candidate) => candidate.path === file.path)
    if (!local || local.sha256 !== file.sha256 || local.size !== file.size)
      throw new Error(
        `Local directory differs from upload session; ${file.path} changed since the session started`,
      )
    if (file.received || status.state === 'ready') continue
    const bytes = await readSent(local.localPath)
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256)
      throw new Error('File changed during upload')
    await sessionCall(`/api/uploads/${session.deploymentId}/files/${file.id}`, {
      method: 'PUT',
      body: bytes,
    })
  }
}

/** Sends files and finalizes, resending files the service could not verify. */
async function finishUpload() {
  for (let round = 1; ; round++) {
    await sendMissingFiles()
    try {
      return await sessionCall(
        `/api/uploads/${session.deploymentId}/finalize`,
        {
          method: 'POST',
        },
      )
    } catch (error) {
      if (error.code !== 'files_missing' || round >= MAX_FINALIZE_ROUNDS)
        throw error
    }
  }
}

if (!session.credential || !session.deploymentId) await authenticate()
if (credentialFile) {
  await writeFile(
    credentialFile,
    JSON.stringify({
      deploymentId: session.deploymentId,
      credential: session.credential,
      api: origin.origin,
      statusUrl: new URL(`/uploads/${session.deploymentId}`, origin).href,
    }),
    { mode: 0o600, flag: 'wx' },
  )
}
const result = await finishUpload()
if (result.state !== 'ready')
  throw new Error('Upload service returned an unexpected result')
// Only what may be shown: never the credential or the cookie.
const output = {
  deploymentId: session.deploymentId,
  state: result.state,
  statusUrl: new URL(`/uploads/${session.deploymentId}`, origin).href,
  ...(typeof session.manageUrl === 'string' && {
    manageUrl: new URL(session.manageUrl, origin).href,
  }),
}
if (reportFile)
  await writeFile(reportFile, JSON.stringify(output, null, 2) + '\n', {
    flag: 'wx',
  })
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
