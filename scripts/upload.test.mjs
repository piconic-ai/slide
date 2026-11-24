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
const cookie = '__Host-slide_owner=private-session-cookie-canary'
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

/**
 * Starts a fake service. `scripted` maps "METHOD path" to responses that are
 * returned, in order, before the default behavior.
 */
async function fixture(scripted = {}) {
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
      cookie: request.headers.cookie,
      origin: request.headers.origin,
      contentType: request.headers['content-type'],
      body,
    })
    response.setHeader('Content-Type', 'application/json')
    const next = scripted[`${request.method} ${request.url}`]?.shift()
    if (next) {
      response.writeHead(next[0], next[2]).end(JSON.stringify(next[1]))
    } else if (
      request.url === '/api/slides/talk/uploads' &&
      request.method === 'POST'
    ) {
      response.end(
        JSON.stringify({
          deploymentId: 'test-deployment',
          credential: canary,
          manageUrl: `http://${request.headers.host}/slides/talk`,
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
    if (key.startsWith('SLIDE_')) delete env[key]
  }
  env.SLIDE_ID = 'talk'
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

test('Given the author’s cookie, When a directory is uploaded over real HTTP, Then the start is sent as the browser sends it and only public fields are reported', async () => {
  const f = await fixture()
  const report = join(f.directory, 'report.json')
  const { stdout, stderr } = await upload(f, {
    SLIDE_OWNER_COOKIE: cookie,
    SLIDE_ATTEMPT: 'attempt-0123456789',
    SLIDE_REPORT_FILE: report,
  })
  const expected = {
    deploymentId: 'test-deployment',
    state: 'ready',
    statusUrl: `${f.origin}/uploads/test-deployment`,
    manageUrl: `${f.origin}/slides/talk`,
  }
  const reportText = await readFile(report, 'utf8')
  expect(JSON.parse(reportText)).toEqual(expected)
  expect(JSON.parse(stdout)).toEqual(expected)
  for (const output of [reportText, stdout, stderr]) {
    expect(output).not.toContain(canary)
    expect(output).not.toContain(cookie)
    expect(output).not.toContain(unexpected)
    expect(output).not.toContain('privateField')
  }
  const start = f.requests[0]
  expect(start).toMatchObject({
    method: 'POST',
    url: '/api/slides/talk/uploads',
    cookie,
    origin: f.origin,
    contentType: 'application/json',
  })
  // The start carries no bearer token: the session is the author’s.
  expect(start.authorization).toBeUndefined()
  expect(JSON.parse(start.body)).toEqual({
    attempt: 'attempt-0123456789',
    entry: 'index.html',
    files: [expect.objectContaining({ path: 'index.html' })],
  })
  const put = f.requests.find((request) => request.method === 'PUT')
  expect(put).toMatchObject({ authorization: `Bearer ${canary}`, body: html })
  // The cookie goes to the start alone.
  expect(put.cookie).toBeUndefined()
  expect(f.requests.at(-1).url).toBe('/api/uploads/test-deployment/finalize')
})

test('Given no attempt is named, When the start is retried, Then every try names the same generated attempt', async () => {
  const f = await fixture({
    'POST /api/slides/talk/uploads': [
      [429, { error: 'busy', code: 'upload_busy' }],
    ],
  })
  await upload(f, { SLIDE_OWNER_COOKIE: cookie, SLIDE_RETRY_DELAY_MS: '1' })
  const attempts = f.requests
    .filter((request) => request.url === '/api/slides/talk/uploads')
    .map((request) => JSON.parse(request.body).attempt)
  expect(attempts).toHaveLength(2)
  expect(attempts[0]).toMatch(/^[A-Za-z0-9_-]{16,64}$/)
  expect(attempts[1]).toBe(attempts[0])
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

test.each(['SLIDE_CREDENTIAL_FILE'])(
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

const actions = () => ({
  SLIDE_RETRY_DELAY_MS: '1',
  SLIDE_OWNER_COOKIE: cookie,
})
const calls = (f, method, url) =>
  f.requests.filter(
    (request) => request.method === method && request.url === url,
  ).length

test('an expired credential is renewed by starting the same attempt again and the same session continues', async () => {
  const renewed = 'renewed-upload-credential-canary'
  const f = await fixture({
    'POST /api/slides/talk/uploads': [
      [201, { deploymentId: 'test-deployment', credential: canary }],
      [201, { deploymentId: 'test-deployment', credential: renewed }],
    ],
    'PUT /api/uploads/test-deployment/files/0': [
      [401, { error: 'expired', code: 'credential_expired' }],
    ],
  })
  const { stdout } = await upload(f, actions())
  expect(stdout).toContain('"state": "ready"')
  expect(stdout).not.toContain(renewed)
  expect(
    f.requests.filter(({ method }) => method === 'PUT').at(-1)?.authorization,
  ).toBe(`Bearer ${renewed}`)
  expect(calls(f, 'POST', '/api/slides/talk/uploads')).toBe(2)
  const attempts = f.requests
    .filter((request) => request.url === '/api/slides/talk/uploads')
    .map((request) => JSON.parse(request.body).attempt)
  expect(attempts[1]).toBe(attempts[0])
  expect(calls(f, 'PUT', '/api/uploads/test-deployment/files/0')).toBe(2)
})

test('files the service could not verify are resent before finalizing again', async () => {
  const f = await fixture({
    'POST /api/uploads/test-deployment/finalize': [
      [
        409,
        {
          error: 'Files are missing',
          code: 'files_missing',
          missing: ['index.html'],
        },
      ],
    ],
  })
  await upload(f, actions())
  expect(calls(f, 'PUT', '/api/uploads/test-deployment/files/0')).toBe(2)
  expect(calls(f, 'POST', '/api/uploads/test-deployment/finalize')).toBe(2)
})

test('transient conflicts are retried and a busy start waits for its turn', async () => {
  const f = await fixture({
    'POST /api/slides/talk/uploads': [
      [429, { error: 'busy', code: 'upload_busy' }],
    ],
    'PUT /api/uploads/test-deployment/files/0': [
      [409, { error: 'Another file is being received; retry' }],
    ],
  })
  const { stdout } = await upload(f, actions())
  expect(stdout).toContain('"state": "ready"')
  expect(calls(f, 'POST', '/api/slides/talk/uploads')).toBe(2)
  expect(calls(f, 'PUT', '/api/uploads/test-deployment/files/0')).toBe(2)
})

test('a refused start reports its reason and stops without sending files', async () => {
  const f = await fixture({
    'POST /api/slides/talk/uploads': [
      [
        413,
        {
          error: 'An upload file exceeds the file byte limit',
          code: 'start_rejected',
          reason: 'file_too_large',
          deploymentId: 'refused',
        },
      ],
    ],
  })
  await expect(upload(f, actions())).rejects.toThrow(
    'Upload refused (file_too_large)',
  )
  expect(f.requests.some((request) => request.method === 'PUT')).toBe(false)
})

test.each([
  ['session_expired', 409],
  ['session_failed', 409],
])('a %s session stops instead of retrying', async (code, status) => {
  const f = await fixture({
    'PUT /api/uploads/test-deployment/files/0': [
      [status, { error: code, code }],
    ],
  })
  await expect(upload(f, actions())).rejects.toThrow(`(${status})`)
  expect(calls(f, 'PUT', '/api/uploads/test-deployment/files/0')).toBe(1)
})

test('a credential that expires while resuming cannot be renewed without the author’s cookie', async () => {
  const f = await fixture({
    'GET /api/uploads/test-deployment': [
      [401, { error: 'expired', code: 'credential_expired' }],
    ],
  })
  await expect(
    upload(f, {
      SLIDE_DEPLOYMENT_ID: 'test-deployment',
      SLIDE_UPLOAD_CREDENTIAL: canary,
    }),
  ).rejects.toThrow('Set SLIDE_OWNER_COOKIE')
})

test('a concurrent credential rotation is retried', async () => {
  const f = await fixture({
    'GET /api/uploads/test-deployment': [
      [409, { error: 'changed', code: 'session_changed' }],
    ],
  })
  const { stdout } = await upload(f, actions())
  expect(stdout).toContain('"state": "ready"')
})

test('a rate-limited request waits for Retry-After before retrying', async () => {
  const limited = [
    429,
    { error: 'Too many requests; retry later', code: 'rate_limited' },
    { 'Retry-After': '1' },
  ]
  const f = await fixture({
    'PUT /api/uploads/test-deployment/files/0': [limited],
  })
  const started = Date.now()
  const { stdout } = await upload(f, actions())
  expect(Date.now() - started).toBeGreaterThanOrEqual(1000)
  expect(stdout).toContain('"state": "ready"')
  expect(calls(f, 'PUT', '/api/uploads/test-deployment/files/0')).toBe(2)
})

test('retries stop after five transient failures', async () => {
  const busy = [429, { error: 'busy', code: 'upload_busy' }]
  const f = await fixture({
    'PUT /api/uploads/test-deployment/files/0': Array.from(
      { length: 6 },
      () => busy,
    ),
  })
  await expect(upload(f, actions())).rejects.toThrow('(429)')
  expect(calls(f, 'PUT', '/api/uploads/test-deployment/files/0')).toBe(5)
})

test('finalize gives up after three rounds of missing files', async () => {
  const missing = [
    409,
    {
      error: 'Files are missing',
      code: 'files_missing',
      missing: ['index.html'],
    },
  ]
  const f = await fixture({
    'POST /api/uploads/test-deployment/finalize': [missing, missing, missing],
  })
  await expect(upload(f, actions())).rejects.toThrow('(409)')
  expect(calls(f, 'POST', '/api/uploads/test-deployment/finalize')).toBe(3)
})

test('a result that is not ready is refused and nothing is reported', async () => {
  const f = await fixture({
    'POST /api/uploads/test-deployment/finalize': [
      [200, { state: 'uploading' }],
    ],
  })
  const report = join(f.directory, 'report.json')
  await expect(
    upload(f, { ...actions(), SLIDE_REPORT_FILE: report }),
  ).rejects.toThrow('unexpected result')
  await expect(readFile(report, 'utf8')).rejects.toThrow()
})

test.each([
  ['no slide', { SLIDE_ID: '' }, 'Set SLIDE_ID'],
  ['a slide that is not a slug', { SLIDE_ID: 'Not A Slug' }, 'Set SLIDE_ID'],
  ['no cookie', {}, 'Set SLIDE_OWNER_COOKIE'],
])(
  'Given %s, When an upload starts, Then it stops before any request',
  async (_, env, message) => {
    const f = await fixture()
    await expect(upload(f, env)).rejects.toThrow(message)
    expect(f.requests).toEqual([])
  },
)
