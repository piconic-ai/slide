import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, test } from 'vitest'

const run = promisify(execFile)
const canary = 'private-upload-token-canary'
const unexpected = 'unexpected-private-server-field'
const html = '<h1>Upload boundary test</h1>'
const temporaryDirectories = []
const servers = []
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise((resolve) => server.close(resolve))),
  )
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'slide-upload-test-'))
  temporaryDirectories.push(directory)
  const source = join(directory, 'source')
  await mkdir(source)
  await writeFile(join(source, 'index.html'), html)
  const requests = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    requests.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.authorization,
      body,
    })
    response.setHeader('Content-Type', 'application/json')
    if (request.url.startsWith('/oidc?')) {
      response.end(JSON.stringify({ value: 'test-oidc-token' }))
    } else if (
      request.url === '/api/decks/talk/uploads' &&
      request.method === 'POST'
    ) {
      response.end(
        JSON.stringify({
          deploymentId: 'test-deployment',
          credential: canary,
          privateField: unexpected,
        }),
      )
    } else if (
      request.url === '/api/uploads/test-deployment' &&
      request.method === 'GET'
    ) {
      response.end(
        JSON.stringify({
          state: 'uploading',
          files: [
            {
              id: '0',
              path: 'index.html',
              size: Buffer.byteLength(html),
              sha256: createHash('sha256').update(html).digest('hex'),
              received: false,
            },
          ],
        }),
      )
    } else if (
      request.url === '/api/uploads/test-deployment/files/0' &&
      request.method === 'PUT'
    ) {
      response.end('{}')
    } else if (
      request.url === '/api/uploads/test-deployment/finalize' &&
      request.method === 'POST'
    ) {
      response.end(
        JSON.stringify({
          commit: 'test-commit',
          state: 'ready',
          credential: canary,
          privateField: unexpected,
        }),
      )
    } else {
      response.writeHead(404).end('{}')
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  servers.push(server)
  const origin = `http://127.0.0.1:${server.address().port}`
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (
      key.startsWith('SLIDE_') ||
      key.startsWith('ACTIONS_') ||
      ['GITHUB_ACTIONS', 'GITHUB_OUTPUT'].includes(key)
    )
      delete env[key]
  }
  env.SLIDE_DECK = 'talk'
  return { directory, source, requests, origin, env }
}

function upload(fixture, env) {
  return run(
    process.execPath,
    ['scripts/upload.mjs', fixture.source, fixture.origin],
    {
      env: { ...fixture.env, ...env },
      timeout: 10_000,
    },
  )
}

test('GitHub Actions publishes only the allowlisted report after a real HTTP upload', async () => {
  const f = await fixture()
  const report = join(f.directory, 'report.json')
  const githubOutput = join(f.directory, 'github-output')
  const { stdout, stderr } = await upload(f, {
    GITHUB_ACTIONS: 'true',
    GITHUB_OUTPUT: githubOutput,
    SLIDE_REPORT_FILE: report,
    ACTIONS_ID_TOKEN_REQUEST_URL: `${f.origin}/oidc`,
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-request-token',
  })
  const expected = {
    deploymentId: 'test-deployment',
    commit: 'test-commit',
    state: 'ready',
    statusUrl: `${f.origin}/uploads/test-deployment`,
  }
  const reportText = await readFile(report, 'utf8')
  const outputText = await readFile(githubOutput, 'utf8')
  expect(JSON.parse(reportText)).toEqual(expected)
  const maskCommand = `::add-mask::${canary}\n`
  expect(stdout.startsWith(maskCommand)).toBe(true)
  const publicStdout = stdout.slice(maskCommand.length)
  expect(JSON.parse(publicStdout)).toEqual(expected)
  expect(outputText).toBe(
    Object.entries(expected)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''),
  )
  for (const output of [reportText, outputText, publicStdout, stderr]) {
    expect(output).not.toContain(canary)
    expect(output).not.toContain(unexpected)
    expect(output).not.toContain('privateField')
  }
  expect(f.requests.find((request) => request.method === 'PUT')).toMatchObject({
    authorization: `Bearer ${canary}`,
    body: html,
  })
  expect(f.requests.at(-1).url).toBe('/api/uploads/test-deployment/finalize')
})

test('local private receipts retain the credential with owner-only permissions', async () => {
  const f = await fixture()
  const receipt = join(f.directory, 'private-receipt.json')
  const { stdout } = await upload(f, {
    SLIDE_DEPLOYMENT_ID: 'test-deployment',
    SLIDE_UPLOAD_CREDENTIAL: canary,
    SLIDE_CREDENTIAL_FILE: receipt,
  })
  expect(JSON.parse(await readFile(receipt, 'utf8'))).toEqual({
    deploymentId: 'test-deployment',
    credential: canary,
    api: f.origin,
    statusUrl: `${f.origin}/uploads/test-deployment`,
  })
  expect((await stat(receipt)).mode & 0o777).toBe(0o600)
  expect(stdout).not.toContain(canary)
  await expect(
    upload(f, {
      SLIDE_DEPLOYMENT_ID: 'test-deployment',
      SLIDE_UPLOAD_CREDENTIAL: canary,
      SLIDE_CREDENTIAL_FILE: receipt,
    }),
  ).rejects.toThrow()
  expect(JSON.parse(await readFile(receipt, 'utf8')).credential).toBe(canary)
})

test('GitHub Actions rejects private receipts before authentication, network access or writes', async () => {
  const f = await fixture()
  await expect(
    upload(f, {
      GITHUB_ACTIONS: 'true',
      SLIDE_CREDENTIAL_FILE: join(f.directory, 'private-receipt.json'),
      SLIDE_REPORT_FILE: join(f.directory, 'report.json'),
      GITHUB_OUTPUT: join(f.directory, 'github-output'),
      ACTIONS_ID_TOKEN_REQUEST_URL: `${f.origin}/oidc`,
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-request-token',
    }),
  ).rejects.toThrow('SLIDE_CREDENTIAL_FILE is only supported locally')
  expect(f.requests).toEqual([])
  expect(await readdir(f.directory)).toEqual(['source'])
})

test.each(['SLIDE_CREDENTIAL_FILE', 'GITHUB_OUTPUT'])(
  'rejects a public report sharing the %s path before network access',
  async (key) => {
    const f = await fixture()
    const path = join(f.directory, 'output.json')
    await expect(
      upload(f, {
        SLIDE_REPORT_FILE: path,
        [key]: join(f.directory, '.', 'output.json'),
      }),
    ).rejects.toThrow('Output files must use different paths')
    expect(f.requests).toEqual([])
    expect(await readdir(f.directory)).toEqual(['source'])
  },
)
