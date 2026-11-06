import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const origin = process.argv[2] ?? 'http://localhost:8794'
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
  throw new Error('Local verification only')
const temporary = await mkdtemp(join(tmpdir(), 'slide-verify-'))
const id = randomUUID()
const credential = `${randomUUID()}.${randomUUID()}`
const html = '<!doctype html><h1>Private upload verified</h1>'
const nested = 'Nested content path verified'
const directory = join(temporary, 'slides')
const hash = (value) => createHash('sha256').update(value).digest('hex')
const created = Math.floor(Date.now() / 1000)
try {
  await mkdir(join(directory, 'assets/content'), { recursive: true })
  await writeFile(join(directory, 'index.html'), html)
  await writeFile(join(directory, 'assets/content/note.txt'), nested)
  await writeFile(
    join(temporary, 'seed.sql'),
    `INSERT INTO deployments
    (id,idempotency_key,inventory_digest,source_sha,run_id,run_attempt,actor_id,repository_id,owner_id,source_ref,state,total_bytes,token_hash,created_at,expires_at)
    VALUES ('${id}','local-${id}','local','${'a'.repeat(40)}','1','1','722500','1446590227','248307881','refs/heads/main','uploading',${Buffer.byteLength(html)},'${hash(credential)}',${created},${created + 3600});
    INSERT INTO upload_files (deployment_id,id,path,size,sha256,media_type) VALUES
    ('${id}','0','index.html',${Buffer.byteLength(html)},'${hash(html)}','text/html; charset=utf-8'),
    ('${id}','1','assets/content/note.txt',${Buffer.byteLength(nested)},'${hash(nested)}','text/plain; charset=utf-8');`,
  )
  execFileSync(
    'node_modules/.bin/wrangler',
    [
      'd1',
      'execute',
      'slide',
      '--local',
      '--file',
      join(temporary, 'seed.sql'),
    ],
    {
      env: {
        ...process.env,
        WRANGLER_LOG_PATH: join(temporary, 'wrangler.log'),
      },
      stdio: 'pipe',
    },
  )
  const api = `/api/uploads/${id}`
  const headers = { Authorization: `Bearer ${credential}` }
  assert.equal((await fetch(origin + api)).status, 401)
  assert.equal(
    (await fetch(origin + api + '/finalize', { method: 'POST', headers }))
      .status,
    409,
  )
  assert.equal(
    (
      await fetch(origin + api + '/files/0', {
        method: 'PUT',
        headers,
        body: 'wrong',
      })
    ).status,
    400,
  )
  const output = execFileSync(
    process.execPath,
    ['scripts/upload.mjs', directory, origin],
    {
      env: {
        ...process.env,
        SLIDE_UPLOAD_CREDENTIAL: credential,
        SLIDE_DEPLOYMENT_ID: id,
        SLIDE_CREDENTIAL_FILE: join(temporary, 'receipt.json'),
      },
      encoding: 'utf8',
    },
  )
  assert.equal(JSON.parse(output).state, 'ready')
  assert.equal(output.includes(credential), false)
  assert.equal(
    JSON.parse(await readFile(join(temporary, 'receipt.json'), 'utf8'))
      .credential,
    credential,
  )
  assert.equal((await fetch(origin + api + '/content/index.html')).status, 401)
  assert.equal(
    await (
      await fetch(origin + api + '/content/index.html', { headers })
    ).text(),
    html,
  )
  assert.equal(
    await (
      await fetch(origin + api + '/content/assets/content/note.txt', {
        headers,
      })
    ).text(),
    nested,
  )
  assert.equal(
    (
      await fetch(origin + api + '/files/0', {
        method: 'PUT',
        headers,
        body: html,
      })
    ).status,
    409,
  )
  assert.equal(
    (await fetch(origin + api + '/finalize', { method: 'POST', headers }))
      .status,
    200,
  )
  assert.equal(
    (
      await fetch(origin + '/api/uploads', {
        method: 'POST',
        headers: { Authorization: 'Bearer invalid-token-value-123456789' },
        body: '{}',
      })
    ).status,
    401,
  )
  console.log(
    'PASS local D1/R2 upload, hash rejection, missing-file recovery, ready replay, immutable files, private content, OIDC rejection, safe CLI outputs',
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
