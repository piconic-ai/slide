#!/usr/bin/env node
import { createHash } from 'node:crypto'
import {
  lstat,
  readdir,
  readFile,
  appendFile,
  writeFile,
} from 'node:fs/promises'
import { resolve, join } from 'node:path'

const [directory, endpoint = 'https://slide.piconic.ai'] = process.argv.slice(2)
if (!directory)
  throw new Error('Usage: node scripts/upload.mjs DIRECTORY [SERVICE_URL]')
const deck = process.env.SLIDE_DECK
const credentialFile = process.env.SLIDE_CREDENTIAL_FILE
const reportFile = process.env.SLIDE_REPORT_FILE
if (credentialFile && process.env.GITHUB_ACTIONS === 'true') {
  throw new Error(
    'SLIDE_CREDENTIAL_FILE is only supported locally; use SLIDE_REPORT_FILE in GitHub Actions',
  )
}
const outputPaths = [credentialFile, reportFile, process.env.GITHUB_OUTPUT]
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
    const bytes = await readFile(join(root, path))
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
const retryDelay = Number(process.env.SLIDE_RETRY_DELAY_MS ?? 1000)
const MAX_ATTEMPTS = 5
const MAX_FINALIZE_ROUNDS = 3
const session = {
  credential: process.env.SLIDE_UPLOAD_CREDENTIAL,
  deploymentId: process.env.SLIDE_DEPLOYMENT_ID,
}

class ServiceError extends Error {
  constructor(status, data) {
    super(`Upload request failed (${status}): ${data.error ?? 'Unknown error'}`)
    this.status = status
    this.code = data.code
    this.data = data
  }
}

async function call(path, { token, ...options }) {
  const response = await fetch(new URL(path, origin), {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new ServiceError(response.status, data)
  return data
}

// Conflicts without a code, busy answers, and server errors may succeed later.
const isTransient = (error) =>
  error instanceof ServiceError &&
  (error.status === 429 ||
    error.status >= 500 ||
    (error.status === 409 && (!error.code || error.code === 'session_changed')))

async function withRetry(operation) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (!isTransient(error) || attempt >= MAX_ATTEMPTS) throw error
      await new Promise((resolve) => setTimeout(resolve, retryDelay * attempt))
    }
  }
}

async function oidcToken() {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  if (!requestUrl || !requestToken) return null
  const url = new URL(requestUrl)
  // The token is bound to the service it is sent to, so another host cannot
  // replay it against production.
  url.searchParams.set(
    'audience',
    process.env.SLIDE_OIDC_AUDIENCE ?? origin.origin,
  )
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${requestToken}` },
  })
  if (!response.ok) throw new Error('GitHub OIDC token request failed')
  return (await response.json()).value
}

function maskCredential() {
  if (process.env.GITHUB_ACTIONS === 'true')
    process.stdout.write(`::add-mask::${session.credential}\n`)
}

/** Starts the session, or with a fresh identity renews its credential. */
async function authenticate() {
  if (!deck || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(deck))
    throw new Error('Set SLIDE_DECK to the deck connected to this repository')
  const body = JSON.stringify({
    entry: 'index.html',
    files: localFiles.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
  })
  try {
    const started = await withRetry(async () => {
      const token = await oidcToken()
      if (!token)
        throw new Error(
          'Run in GitHub Actions with id-token: write, or supply SLIDE_UPLOAD_CREDENTIAL and SLIDE_DEPLOYMENT_ID to resume',
        )
      return call(`/api/decks/${deck}/uploads`, {
        token,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
    })
    session.credential = started.credential
    session.deploymentId = started.deploymentId
    maskCredential()
  } catch (error) {
    throw explainRefusal(error)
  }
}

function explainRefusal(error) {
  if (!(error instanceof ServiceError) || !error.data.reason) return error
  return new Error(
    `Upload refused (${error.data.reason}): ${error.data.error}. Check the deck history for details.`,
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
      throw new Error('Local directory differs from upload session')
    if (file.received || status.state === 'ready') continue
    const bytes = await readFile(join(root, local.localPath))
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
else maskCredential()
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
// Output values reach GITHUB_OUTPUT, so they must not carry line breaks.
if (!/^[0-9a-f]{40}$/.test(result.commit) || result.state !== 'ready')
  throw new Error('Upload service returned an unexpected result')
const output = {
  deploymentId: session.deploymentId,
  commit: result.commit,
  state: result.state,
  statusUrl: new URL(`/uploads/${session.deploymentId}`, origin).href,
}
if (reportFile)
  await writeFile(reportFile, JSON.stringify(output, null, 2) + '\n', {
    flag: 'wx',
  })
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
if (process.env.GITHUB_OUTPUT) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    Object.entries(output)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''),
  )
}
