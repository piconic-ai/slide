// Seeds a local Worker with two public decks to try reactions: a deck built
// elsewhere, and examples/citing, which links to pages of the first. Both go
// through the real uploader, so the links are read when each upload is
// finalized. Local only; it writes the local D1 with wrangler.
//
//   node scripts/demo-reactions.mjs <built deck directory> [origin]
//
// The built deck may expect to be served under a path, such as
// /slides/my-talk/. Name that path in SLIDE_DEMO_BASE to keep it working.
import { createHash, createHmac, randomUUID } from 'node:crypto'
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, relative } from 'node:path'
import { execFileSync } from 'node:child_process'

const [source, originArgument] = process.argv
  .slice(2)
  .filter((argument) => !argument.startsWith('--'))
if (!source) throw new Error('Name the directory of a built deck')
const origin = originArgument ?? 'http://localhost:8794'
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
  throw new Error('Local demo only')

/** The owner the Worker allows to sign in, from wrangler.jsonc. */
const OWNER = { id: '722500', handle: 'kfly8' }
/** A second author, who exists only in the local database. */
const READER = { id: '900001', handle: 'demo-reader' }
const CITED = process.env.SLIDE_DEMO_DECK ?? 'barefootjs-testing'
const CITING = 'citing-demo'
/** The origin examples/citing is written against. */
const PRODUCTION = 'https://slide.piconic.ai'
/** Must match BETTER_AUTH_SECRET of the local Worker; never used elsewhere. */
const SECRET =
  process.env.BETTER_AUTH_SECRET ?? 'local-demo-only-better-auth-secret-000000'
const persistTo = process.env.SLIDE_PERSIST_TO
const base = (process.env.SLIDE_DEMO_BASE ?? '').replace(/^\/+|\/+$/g, '')

const MEDIA_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
}

const hash = (value) => createHash('sha256').update(value).digest('hex')
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
const now = Math.floor(Date.now() / 1000)
const temporary = await mkdtemp(join(tmpdir(), 'slide-demo-'))

function execute(sql) {
  const file = join(temporary, `${randomUUID()}.sql`)
  return writeFile(file, sql).then(() =>
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
    ),
  )
}

async function filesUnder(directory) {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(directory, join(entry.parentPath, entry.name))
        .split('\\')
        .join('/'),
    )
    .sort()
}

/**
 * Uploads a directory as a new deployment of the deck, then publishes it as
 * the given author's.
 */
async function publish(deck, owner, directory) {
  const id = randomUUID()
  const credential = `${randomUUID()}.${randomUUID()}`
  const paths = await filesUnder(directory)
  const files = await Promise.all(
    paths.map(async (path, index) => {
      const mediaType = MEDIA_TYPES[extname(path)]
      if (!mediaType) throw new Error(`No media type for ${path}`)
      const body = await readFile(join(directory, path))
      return `(${quote(id)},${quote(index)},${quote(path)},${body.byteLength},${quote(hash(body))},${quote(mediaType)})`
    }),
  )
  const total = (
    await Promise.all(paths.map((path) => stat(join(directory, path))))
  ).reduce((sum, file) => sum + file.size, 0)
  await execute(
    `INSERT INTO accounts (user_id,handle,created_at) VALUES (${quote(owner.id)},${quote(owner.handle)},${now})
      ON CONFLICT DO NOTHING;
    INSERT INTO decks (id,owner_user_id,created_at) VALUES (${quote(deck)},${quote(OWNER.id)},${now})
      ON CONFLICT DO NOTHING;
    UPDATE decks SET owner_user_id = ${quote(OWNER.id)} WHERE id = ${quote(deck)};
    INSERT INTO repository_bindings VALUES (${quote(deck)},'1','2','local/demo','["refs/heads/main"]',${quote(OWNER.id)},${now})
      ON CONFLICT(deck_id) DO NOTHING;
    INSERT INTO deployments
    (id,idempotency_key,inventory_digest,source_sha,run_id,run_attempt,actor_id,repository_id,owner_id,source_ref,state,total_bytes,token_hash,created_at,expires_at,credential_expires_at,deck_id)
    VALUES (${quote(id)},${quote(`demo-${id}`)},'demo',${quote('d'.repeat(40))},'1','1',${quote(OWNER.id)},'1','2','refs/heads/main','uploading',${total},${quote(hash(credential))},${now},${now + 3600},${now + 3600},${quote(deck)});
    INSERT INTO upload_files (deployment_id,id,path,size,sha256,media_type) VALUES
    ${files.join(',\n')};`,
  )
  const output = execFileSync(
    process.execPath,
    ['scripts/upload.mjs', directory, origin],
    {
      env: {
        ...process.env,
        SLIDE_UPLOAD_CREDENTIAL: credential,
        SLIDE_DEPLOYMENT_ID: id,
      },
      encoding: 'utf8',
    },
  )
  if (JSON.parse(output).state !== 'ready')
    throw new Error(`Upload of ${deck} did not become ready`)
  // The owner would publish from the deck page; the demo points the deck at
  // the new deployment directly. Uploads are accepted for the allowed owner
  // only, so a deck of another author changes hands after its upload.
  await execute(
    `UPDATE decks SET public_deployment_id = ${quote(id)}, paused_at = NULL,
      resume_deployment_id = NULL, revision = revision + 1,
      owner_user_id = ${quote(owner.id)} WHERE id = ${quote(deck)};`,
  )
  return id
}

/** A session of the allowed owner, as Better Auth signs its cookie. */
async function ownerCookie() {
  const token = randomUUID().replaceAll('-', '')
  const milliseconds = Date.now()
  await execute(
    `INSERT INTO auth_user (id,name,email,email_verified,created_at,updated_at)
      VALUES ('demo-user',${quote(OWNER.handle)},'${OWNER.id}@users.noreply.github.com',0,${milliseconds},${milliseconds})
      ON CONFLICT DO NOTHING;
    INSERT INTO auth_account (id,account_id,provider_id,user_id,created_at,updated_at)
      VALUES ('demo-account',${quote(OWNER.id)},'github','demo-user',${milliseconds},${milliseconds})
      ON CONFLICT DO NOTHING;
    INSERT INTO auth_session (id,token,user_id,expires_at,created_at,updated_at)
      VALUES (${quote(`demo-${token}`)},${quote(token)},'demo-user',${milliseconds + 43200000},${milliseconds},${milliseconds});`,
  )
  const signature = createHmac('sha256', SECRET).update(token).digest('base64')
  return `__Host-slide_owner=${encodeURIComponent(`${token}.${signature}`)}`
}

try {
  const cited = join(temporary, 'cited')
  await mkdir(join(cited, base), { recursive: true })
  await cp(source, join(cited, base), { recursive: true })
  // The entry is served from the root, where its <base> finds the rest. A
  // deck that names itself only at run time gets its manifest's title, so
  // lists show more than the generator's placeholder.
  const manifest = await readFile(join(source, 'manifest.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => null)
  const entry = await readFile(join(source, 'index.html'), 'utf8')
  const titled =
    typeof manifest?.title === 'string'
      ? entry.replace(
          /<title>[^<]*<\/title>/,
          () => `<title>${manifest.title.replace(/[&<>]/g, '')}</title>`,
        )
      : entry
  await writeFile(join(cited, 'index.html'), titled)
  const citing = join(temporary, 'citing')
  await mkdir(citing)
  await writeFile(
    join(citing, 'index.html'),
    (await readFile('examples/citing/index.html', 'utf8')).replaceAll(
      `${PRODUCTION}/@kfly8/barefootjs-testing`,
      `${origin}/@${OWNER.handle}/${CITED}`,
    ),
  )
  await publish(CITED, OWNER, cited)
  await publish(CITING, READER, citing)
  const cookie = await ownerCookie()
  console.log(`Cited deck:   ${origin}/@${OWNER.handle}/${CITED}`)
  console.log(`Citing deck:  ${origin}/@${READER.handle}/${CITING}`)
  console.log(`Owner cookie: ${cookie}`)
  if (process.argv.includes('--login')) {
    // Cookies ignore the port, so a helper on another port can hand the
    // browser the owner session before sending it to the Worker.
    const helper = createServer((_, response) => {
      response.writeHead(302, {
        'Set-Cookie': `${cookie}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=43200`,
        Location: `${origin}/decks/${CITED}/reactions`,
      })
      response.end()
    })
    helper.listen(8795, 'localhost', () =>
      console.log('Sign in:      http://localhost:8795/ (Ctrl+C to stop)'),
    )
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}
