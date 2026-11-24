import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'

const uploader = fileURLToPath(new URL('./upload.mjs', import.meta.url))
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

async function fixture(t, sourceFiles, receiptFiles, resume = false) {
  const root = await mkdtemp(join(tmpdir(), 'slide-path-test-'))
  t.onTestFinished(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, 'input')
  await mkdir(directory)
  for (const [path, bytes] of Object.entries(sourceFiles))
    await writeFile(join(directory, path), bytes)
  const calls = join(root, 'calls.jsonl')
  const preload = join(root, 'fetch.mjs')
  await writeFile(
    preload,
    `import { appendFileSync } from 'node:fs'
const files = ${JSON.stringify(
      receiptFiles.map(([path, bytes], index) => ({
        id: String(index),
        path,
        size: Buffer.byteLength(bytes),
        sha256: sha256(bytes),
        received: false,
      })),
    )}
globalThis.fetch = async (url, options) => {
  url = new URL(url)
  appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ path: url.pathname, method: options.method ?? 'GET', body: options.body?.toString() }) + '\\n')
  if (url.pathname === '/api/slides/talk/uploads') return Response.json({ deploymentId: 'test', credential: 'test-credential-for-local-fixture' })
  if (url.pathname.endsWith('/finalize')) return Response.json({ state: 'ready' })
  if (options.method === 'PUT') return Response.json({ received: true })
  return Response.json({ state: 'uploading', files })
}
`,
  )
  const result = spawnSync(
    process.execPath,
    ['--import', preload, uploader, directory, 'http://localhost:8794'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        SLIDE_UPLOAD_CREDENTIAL: resume
          ? 'test-credential-for-local-fixture'
          : '',
        SLIDE_DEPLOYMENT_ID: resume ? 'test' : '',
        SLIDE_ID: 'talk',
        SLIDE_CREDENTIAL_FILE: '',
        SLIDE_OWNER_COOKIE: '__Host-slide_owner=test-session',
      },
    },
  )
  return {
    ...result,
    directory,
    calls: (await readFile(calls, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
  }
}

test('uploads decomposed filenames using canonical wire paths and original filesystem paths', async (t) => {
  const result = await fixture(
    t,
    { 'index.html': 'index', 'e\u0301.txt': 'accent' },
    [
      ['index.html', 'index'],
      ['é.txt', 'accent'],
    ],
  )
  assert.equal(result.status, 0, result.stderr)
  const inventory = JSON.parse(
    result.calls.find((call) => call.path === '/api/slides/talk/uploads').body,
  )
  assert.deepEqual(inventory.files.map((file) => file.path).sort(), [
    'index.html',
    'é.txt',
  ])
  assert.ok(
    inventory.files.every(
      (file) => Object.keys(file).sort().join(',') === 'path,sha256,size',
    ),
  )
  assert.equal(
    result.calls.find((call) => call.path.endsWith('/files/1')).body,
    'accent',
  )
  assert.equal(JSON.parse(result.stdout).state, 'ready')
})

test('Given a file changed since the session started, When the upload resumes, Then it stops naming the file', async (t) => {
  const result = await fixture(
    t,
    { 'index.html': 'changed' },
    [['index.html', 'index']],
    true,
  )
  assert.notEqual(result.status, 0)
  assert.match(
    result.stderr,
    /Local directory differs from upload session; index\.html changed since the session started/,
  )
})

test('rejects local additions before uploading or finalizing an existing inventory', async (t) => {
  const result = await fixture(
    t,
    { 'index.html': 'index', 'new.txt': 'added' },
    [['index.html', 'index']],
    true,
  )
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Local directory differs from upload session/)
  assert.ok(
    !result.calls.some(
      (call) => call.method === 'PUT' || call.path.endsWith('/finalize'),
    ),
  )
})

test('Given HTML, When a slide is uploaded, Then every file is sent as built, and the directory is unchanged', async (t) => {
  const built = '<!doctype html><head><title>t</title></head><body>b</body>'
  const result = await fixture(
    t,
    { 'index.html': built, 'site.css': '</head>' },
    [
      ['index.html', built],
      ['site.css', '</head>'],
    ],
  )
  assert.equal(result.status, 0, result.stderr)
  const inventory = JSON.parse(
    result.calls.find((call) => call.path === '/api/slides/talk/uploads').body,
  )
  assert.deepEqual(
    inventory.files.find((file) => file.path === 'index.html'),
    {
      path: 'index.html',
      sha256: sha256(built),
      size: Buffer.byteLength(built),
    },
  )
  assert.equal(
    result.calls.find((call) => call.path.endsWith('/files/0')).body,
    built,
  )
  assert.equal(
    result.calls.find((call) => call.path.endsWith('/files/1')).body,
    '</head>',
  )
  assert.equal(
    await readFile(join(result.directory, 'index.html'), 'utf8'),
    built,
  )
})
