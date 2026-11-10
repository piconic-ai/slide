import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, test } from 'vitest'

const run = promisify(execFile)
const cleanups = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

/**
 * A service that, like the real one, admits one active upload per account
 * and answers 429 upload_busy to other starts until that upload finalizes.
 * `holdMs` keeps each upload active before finalize answers.
 */
async function busyService({ holdMs, alwaysBusy = false }) {
  const html = '<h1>Busy start test</h1>'
  const directory = await mkdtemp(join(tmpdir(), 'slide-busy-test-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  await mkdir(join(directory, 'source'))
  await writeFile(join(directory, 'source', 'index.html'), html)
  const starts = []
  let active = null
  let next = 0
  const server = createServer(async (request, response) => {
    for await (const _ of request);
    response.setHeader('Content-Type', 'application/json')
    const url = new URL(request.url, 'http://local')
    if (url.pathname === '/oidc')
      return response.end(JSON.stringify({ value: 'test-oidc-token' }))
    if (
      request.method === 'POST' &&
      url.pathname === '/api/decks/talk/uploads'
    ) {
      starts.push(Date.now())
      if (alwaysBusy || active)
        return response.writeHead(429).end(
          JSON.stringify({
            error: 'Another upload is in progress; retry later',
            code: 'upload_busy',
          }),
        )
      active = `deployment-${++next}`
      return response.end(
        JSON.stringify({ deploymentId: active, credential: `${active}-cred` }),
      )
    }
    const [, , , id, action] = url.pathname.split('/')
    if (request.method === 'GET' && !action)
      return response.end(
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
    if (request.method === 'PUT' && action === 'files')
      return response.end('{}')
    if (request.method === 'POST' && action === 'finalize') {
      await new Promise((resolve) => setTimeout(resolve, holdMs))
      if (active === id) active = null
      return response.end(
        JSON.stringify({ commit: 'c'.repeat(40), state: 'ready' }),
      )
    }
    response.writeHead(404).end('{}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise((resolve) => server.close(resolve)))
  const origin = `http://127.0.0.1:${server.address().port}`
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith('SLIDE_') &&
        !key.startsWith('ACTIONS_') &&
        !['GITHUB_ACTIONS', 'GITHUB_OUTPUT'].includes(key),
    ),
  )
  const upload = () =>
    run(
      process.execPath,
      ['scripts/upload.mjs', join(directory, 'source'), origin],
      {
        timeout: 15_000,
        env: {
          ...env,
          SLIDE_DECK: 'talk',
          // Scales every wait: busy starts wait from 50 ms, for up to 3 s.
          SLIDE_RETRY_DELAY_MS: '10',
          ACTIONS_ID_TOKEN_REQUEST_URL: `${origin}/oidc`,
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-request-token',
        },
      },
    )
  return { upload, starts }
}

test('two uploads started together both finish; the later one waits for the first', async () => {
  // Given the first upload stays active longer than the five quick retries
  // (10 + 20 + 30 + 40 ms at this scale) that used to give up
  const service = await busyService({ holdMs: 600 })
  // When two uploads for the same account start at once
  const results = await Promise.all([service.upload(), service.upload()])
  // Then both are ready, on different deployments
  const outputs = results.map(({ stdout }) => JSON.parse(stdout))
  expect(outputs.map((output) => output.state)).toEqual(['ready', 'ready'])
  expect(new Set(outputs.map((output) => output.deploymentId)).size).toBe(2)
  // And the waiting one says why it waits
  expect(results.map(({ stderr }) => stderr).join('')).toContain(
    'Another upload for this account is in progress',
  )
  expect(service.starts.length).toBeGreaterThan(2)
}, 20_000)

test('a start that stays busy past the budget fails with the reason and what to do', async () => {
  // Given another upload never finishes
  const service = await busyService({ holdMs: 0, alwaysBusy: true })
  const started = Date.now()
  // When an upload starts, it fails after the 3 s budget at this scale
  const error = await service.upload().then(
    () => null,
    (error) => error,
  )
  expect(error?.stderr).toContain('Upload start stayed busy (upload_busy)')
  expect(error.stderr).toContain('max-parallel: 1')
  expect(Date.now() - started).toBeGreaterThanOrEqual(2000)
  // And it keeps polling instead of stopping after five tries
  expect(service.starts.length).toBeGreaterThan(5)
}, 20_000)
