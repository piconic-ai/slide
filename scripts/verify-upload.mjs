// Checks the upload routes of a local Worker over real HTTP, D1 and R2: who
// may start, what a credential may do, and that a finished version cannot
// change. With wrangler it writes only the author's session and the slide to
// the local D1; the upload itself goes through the routes.
//
//   node scripts/verify-upload.mjs [origin]
//
// SLIDE_PERSIST_TO names the state directory of a Worker started with
// --persist-to, and BETTER_AUTH_SECRET the secret that Worker runs with.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { ownerSessionSql, signOwnerCookie } from './owner-cookie.mjs'

const origin = process.argv[2] ?? 'http://localhost:8794'
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
  throw new Error('Local verification only')
/** The owner the Worker allows to sign in, from wrangler.jsonc. */
const OWNER = { id: '722500', handle: 'kfly8' }
const DECK = 'local-verify'
/** Must match BETTER_AUTH_SECRET of the local Worker; never used elsewhere. */
const SECRET =
  process.env.BETTER_AUTH_SECRET ?? 'local-demo-only-better-auth-secret-000000'
const persistTo = process.env.SLIDE_PERSIST_TO
const temporary = await mkdtemp(join(tmpdir(), 'slide-verify-'))
const html = '<!doctype html><h1>Private upload verified</h1>'
const nested = 'Nested content path verified'
const directory = join(temporary, 'slides')
const hash = (value) => createHash('sha256').update(value).digest('hex')
const created = Math.floor(Date.now() / 1000)
const attempt = randomUUID()
const inventory = {
  attempt,
  entry: 'index.html',
  files: [
    { path: 'index.html', size: Buffer.byteLength(html), sha256: hash(html) },
    {
      path: 'assets/content/note.txt',
      size: Buffer.byteLength(nested),
      sha256: hash(nested),
    },
  ],
}

async function execute(sql) {
  const file = join(temporary, `${randomUUID()}.sql`)
  await writeFile(file, sql)
  execFileSync(
    'node_modules/.bin/wrangler',
    [
      'd1',
      'execute',
      'slide',
      '--local',
      '--file',
      file,
      ...(persistTo ? ['--persist-to', persistTo] : []),
    ],
    {
      env: {
        ...process.env,
        WRANGLER_LOG_PATH: join(temporary, 'wrangler.log'),
      },
      stdio: 'pipe',
    },
  )
}

/** Sends a start as given; a browser's start names the cookie and origin. */
const start = (headers, body = JSON.stringify(inventory)) =>
  fetch(`${origin}/api/slides/${DECK}/uploads`, {
    method: 'POST',
    headers,
    body,
  })

try {
  await mkdir(join(directory, 'assets/content'), { recursive: true })
  await writeFile(join(directory, 'index.html'), html)
  await writeFile(join(directory, 'assets/content/note.txt'), nested)
  const token = randomUUID().replaceAll('-', '')
  await execute(
    `INSERT INTO accounts (user_id,handle,created_at) VALUES ('${OWNER.id}','${OWNER.handle}',${created})
      ON CONFLICT DO NOTHING;
    INSERT INTO decks (id,slug,owner_user_id,created_at) VALUES ('${DECK}','${DECK}','${OWNER.id}',${created})
      ON CONFLICT DO NOTHING;
    ${ownerSessionSql({ githubId: OWNER.id, name: OWNER.handle, token, now: Date.now() })}`,
  )
  const cookie = signOwnerCookie(token, SECRET)
  const json = { 'Content-Type': 'application/json' }
  const browser = { ...json, Cookie: cookie, Origin: origin }

  // Who may start.
  assert.equal((await start({ ...json, Origin: origin })).status, 401)
  assert.equal(
    (
      await start({
        ...json,
        Origin: origin,
        // What a GitHub Actions workflow used to send.
        Authorization: `Bearer eyJhbGciOiJSUzI1NiJ9.${'a'.repeat(40)}.sig`,
      })
    ).status,
    401,
  )
  // A start must come from a page of the service itself, whatever its type.
  for (const from of ['https://evil.example', 'null', ''])
    for (const type of ['application/json', 'text/plain'])
      assert.equal(
        (await start({ Cookie: cookie, Origin: from, 'Content-Type': type }))
          .status,
        403,
        `start from origin ${JSON.stringify(from)} as ${type}`,
      )
  assert.equal(
    (await start({ ...browser, 'Content-Type': 'text/plain' })).status,
    415,
  )
  assert.equal(
    (
      await fetch(`${origin}/api/slides/no-such-slide/uploads`, {
        method: 'POST',
        headers: browser,
        body: JSON.stringify(inventory),
      })
    ).status,
    404,
  )

  // An upload a stopped sender left open does not block the next start.
  const abandoned = await start(
    browser,
    JSON.stringify({ ...inventory, attempt: randomUUID() }),
  )
  assert.equal(abandoned.status, 201)
  const left = await abandoned.json()

  // What the credential of a started upload may do.
  const started = await start(browser)
  assert.equal(started.status, 201)
  const first = await started.json()
  assert.equal(first.slug, DECK)
  assert.equal(first.manageUrl, `${origin}/slides/${DECK}`)
  const api = `/api/uploads/${first.deploymentId}`
  const bearer = (credential) => ({ Authorization: `Bearer ${credential}` })
  assert.notEqual(first.deploymentId, left.deploymentId)
  const given = await fetch(`${origin}/api/uploads/${left.deploymentId}`, {
    headers: bearer(left.credential),
  })
  assert.equal(given.status, 409)
  assert.equal((await given.json()).code, 'session_expired')
  assert.equal((await fetch(origin + api)).status, 401)
  assert.equal(
    (await fetch(origin + api, { headers: { Cookie: cookie } })).status,
    401,
  )
  assert.equal(
    (
      await fetch(origin + api + '/finalize', {
        method: 'POST',
        headers: bearer(first.credential),
      })
    ).status,
    409,
  )
  assert.equal(
    (
      await fetch(origin + api + '/files/0', {
        method: 'PUT',
        headers: bearer(first.credential),
        body: 'wrong',
      })
    ).status,
    400,
  )

  // The uploader continues the same attempt with a fresh credential.
  const output = execFileSync(
    process.execPath,
    ['scripts/upload.mjs', directory, origin],
    {
      env: {
        ...process.env,
        SLIDE_ID: DECK,
        SLIDE_OWNER_COOKIE: cookie,
        SLIDE_ATTEMPT: attempt,
        // The inventory above lists the files as built.
        SLIDE_PAGE_SCRIPT: 'false',
        SLIDE_CREDENTIAL_FILE: join(temporary, 'receipt.json'),
      },
      encoding: 'utf8',
    },
  )
  const result = JSON.parse(output)
  assert.equal(result.state, 'ready')
  assert.equal(result.deploymentId, first.deploymentId)
  const { credential } = JSON.parse(
    await readFile(join(temporary, 'receipt.json'), 'utf8'),
  )
  assert.notEqual(credential, first.credential)
  assert.equal(output.includes(credential), false)
  assert.equal(output.includes(cookie), false)
  // The credential the restart replaced no longer works.
  assert.equal(
    (await fetch(origin + api, { headers: bearer(first.credential) })).status,
    401,
  )
  const headers = bearer(credential)

  // A ready version is private and cannot change.
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
  console.log(
    'PASS local D1/R2 upload: session start, refused starts (no session, OIDC token, JSON and plain text from another origin or none, not JSON, unknown slide), a new start replacing an upload left open, hash rejection, missing-file refusal, credential rotation, ready replay, immutable files, private content, safe CLI outputs',
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
