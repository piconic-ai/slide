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
const credentialFile = process.env.SLIDE_CREDENTIAL_FILE
if (credentialFile && process.env.GITHUB_ACTIONS === 'true') {
  throw new Error('SLIDE_CREDENTIAL_FILE is only supported locally')
}
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
    if (info.size > 5 * 1024 * 1024)
      throw new Error(`File exceeds 5 MiB: ${path}`)
    const bytes = await readFile(join(root, path))
    localFiles.push({
      path,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
    if (
      localFiles.length > 100 ||
      localFiles.reduce((total, file) => total + file.size, 0) >
        10 * 1024 * 1024
    ) {
      throw new Error('Directory exceeds 100 files or 10 MiB')
    }
  }
}
await walk()
let credential = process.env.SLIDE_UPLOAD_CREDENTIAL
let deploymentId = process.env.SLIDE_DEPLOYMENT_ID
async function request(path, { token = credential, ...options } = {}) {
  const response = await fetch(new URL(path, origin), {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  })
  const data = await response.json()
  if (!response.ok)
    throw new Error(
      `Upload request failed (${response.status}): ${data.error ?? 'Unknown error'}`,
    )
  return data
}
if (!credential || !deploymentId) {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  if (!requestUrl || !requestToken)
    throw new Error(
      'Run in GitHub Actions with id-token: write, or supply SLIDE_UPLOAD_CREDENTIAL and SLIDE_DEPLOYMENT_ID to resume',
    )
  const url = new URL(requestUrl)
  url.searchParams.set(
    'audience',
    process.env.SLIDE_OIDC_AUDIENCE ?? 'https://slide.piconic.ai',
  )
  const oidcResponse = await fetch(url, {
    headers: { Authorization: `Bearer ${requestToken}` },
  })
  if (!oidcResponse.ok) throw new Error('GitHub OIDC token request failed')
  const oidc = await oidcResponse.json()
  const session = await request('/api/uploads', {
    token: oidc.value,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entry: 'index.html', files: localFiles }),
  })
  credential = session.credential
  deploymentId = session.deploymentId
}
if (process.env.GITHUB_ACTIONS === 'true')
  process.stdout.write(`::add-mask::${credential}\n`)
if (credentialFile) {
  await writeFile(
    credentialFile,
    JSON.stringify({
      deploymentId,
      credential,
      api: origin.origin,
      statusUrl: new URL(`/uploads/${deploymentId}`, origin).href,
    }),
    { mode: 0o600, flag: 'wx' },
  )
}
const status = await request(`/api/uploads/${deploymentId}`)
for (const file of status.files) {
  const local = localFiles.find((candidate) => candidate.path === file.path)
  if (!local || local.sha256 !== file.sha256 || local.size !== file.size)
    throw new Error('Local directory differs from upload session')
  if (file.received || status.state === 'ready') continue
  const bytes = await readFile(join(root, local.path))
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256)
    throw new Error('File changed during upload')
  await request(`/api/uploads/${deploymentId}/files/${file.id}`, {
    method: 'PUT',
    body: bytes,
  })
}
const result = await request(`/api/uploads/${deploymentId}/finalize`, {
  method: 'POST',
})
const output = {
  deploymentId,
  commit: result.commit,
  state: result.state,
  statusUrl: new URL(`/uploads/${deploymentId}`, origin).href,
}
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
if (process.env.GITHUB_OUTPUT) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    Object.entries(output)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''),
  )
}
