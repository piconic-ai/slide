// Seeds a local Worker with two public decks to try reactions: a deck built
// elsewhere, and examples/citing, which links to pages of the first. Both are
// sent the way a browser sends them: the upload starts with the author's
// session, and the files and the finalize go through the real routes, so the
// links are read when each upload is finalized. Local only; with wrangler it
// writes the author's session, the decks and their publication to the local
// D1, and nothing of the uploads themselves.
//
//   node scripts/demo-reactions.mjs <built deck directory> [origin]
//
// The built deck may expect to be served under a path, such as
// /slides/my-talk/. Name that path in SLIDE_DEMO_BASE to keep it working.
import { randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { ownerSessionSql, signOwnerCookie } from './owner-cookie.mjs'

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
const DESCRIPTION =
  process.env.SLIDE_DEMO_DESCRIPTION ??
  'BarefootJS のテストで実際に使っている六つのテスト技法を、事例とともに紹介します。'
/** The origin examples/citing is written against. */
const PRODUCTION = 'https://slide.community'
/** Must match BETTER_AUTH_SECRET of the local Worker; never used elsewhere. */
const SECRET =
  process.env.BETTER_AUTH_SECRET ?? 'local-demo-only-better-auth-secret-000000'
const persistTo = process.env.SLIDE_PERSIST_TO
const base = (process.env.SLIDE_DEMO_BASE ?? '').replace(/^\/+|\/+$/g, '')

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

/** A session of the allowed owner, as Better Auth signs its cookie. */
async function ownerCookie() {
  const token = randomUUID().replaceAll('-', '')
  await execute(
    ownerSessionSql({
      githubId: OWNER.id,
      name: OWNER.handle,
      token,
      now: Date.now(),
    }),
  )
  return signOwnerCookie(token, SECRET)
}

/**
 * Sends a directory as a new version of the deck, then publishes it as the
 * given author's. The upload is the signed-in owner's: the Worker lets only
 * a registered author start one.
 */
async function publish(deck, owner, directory, cookie) {
  await execute(
    `INSERT INTO accounts (user_id,handle,created_at) VALUES (${quote(owner.id)},${quote(owner.handle)},${now})
      ON CONFLICT DO NOTHING;
    INSERT INTO decks (id,slug,owner_user_id,created_at) VALUES (${quote(deck)},${quote(deck)},${quote(OWNER.id)},${now})
      ON CONFLICT DO NOTHING;
    UPDATE decks SET owner_user_id = ${quote(OWNER.id)} WHERE id = ${quote(deck)};`,
  )
  const output = execFileSync(
    process.execPath,
    ['scripts/upload.mjs', directory, origin],
    {
      env: { ...process.env, SLIDE_ID: deck, SLIDE_OWNER_COOKIE: cookie },
      encoding: 'utf8',
    },
  )
  const { deploymentId: id, state } = JSON.parse(output)
  if (state !== 'ready' || !/^[0-9a-f-]{36}$/.test(id))
    throw new Error(`Upload of ${deck} did not become ready`)
  // The owner would publish from the deck page; the demo points the deck at
  // the new deployment directly. Uploads are accepted for the allowed owner
  // only, so a deck of another author changes hands after its upload.
  await execute(
    `UPDATE decks SET public_deployment_id = ${quote(id)}, paused_at = NULL,
      resume_deployment_id = NULL, revision = revision + 1,
      first_published_at = COALESCE(first_published_at, ${now}),
      owner_user_id = ${quote(owner.id)} WHERE id = ${quote(deck)};`,
  )
  return id
}

/**
 * The event the cited deck was presented at, with the talks whose slides
 * are on other services. The trial has no screen to enter these yet.
 */
function seedEvent() {
  const elsewhere = [
    {
      title:
        '【前編】このAPIいつ使うん？あの機能なに？V8のドキュメント、全部読んでみた',
      speaker: 'did0es',
      url: 'https://speakerdeck.com/shuta13/zenpen-kono-api-itsu-tsukau-n-ano-kinou-nani-v8-no-dokyumento-zenbu-yon-de-mita',
      player: 'https://speakerdeck.com/player/a5877da0f6d34490ac573c4aca5e7203',
    },
    {
      title: 'TypeScript環境向け DSLを作ろう☕️',
      speaker: 'kazuhi-ra',
      url: 'https://www.docswell.com/s/kazuhi-ra/5X23NX-2026-09-04-125634',
      player: 'https://www.docswell.com/slide/5X23NX/embed',
    },
  ]
  const rows = [
    ...elsewhere.map(
      (talk, index) =>
        `('tokyotojs-03',${index + 1},NULL,${quote(talk.title)},${quote(talk.speaker)},${quote(talk.url)},${quote(talk.player)})`,
    ),
    `('tokyotojs-03',${elsewhere.length + 1},${quote(CITED)},NULL,NULL,NULL,NULL)`,
  ]
  return execute(
    `INSERT INTO communities (id,name,url) VALUES ('kyotojs','Kyoto.js','https://kyotojs.connpass.com/')
      ON CONFLICT DO NOTHING;
    INSERT INTO events (id,community_id,name,url,hashtag,held_on)
      VALUES ('tokyotojs-03','kyotojs','ToKyoto.js #03 - Kyoto.js in Tokyo','https://kyotojs.connpass.com/event/402321/','kyotojs','2026-09-03')
      ON CONFLICT DO NOTHING;
    DELETE FROM event_talks WHERE event_id = 'tokyotojs-03';
    INSERT INTO event_talks (event_id,position,deck_id,title,speaker,url,embed_url) VALUES
    ${rows.join(',\n')};`,
  )
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
  // A deck states its description itself. This one states none, so the demo
  // adds one to show where the viewer puts it.
  await writeFile(
    join(cited, 'index.html'),
    /<meta\s+name=["']?description/i.test(titled)
      ? titled
      : titled.replace(
          /<\/title>/,
          `</title><meta name="description" content="${DESCRIPTION.replace(/[&<>"]/g, '')}">`,
        ),
  )
  const citing = join(temporary, 'citing')
  await mkdir(citing)
  await writeFile(
    join(citing, 'index.html'),
    (await readFile('examples/citing/index.html', 'utf8')).replaceAll(
      `${PRODUCTION}/@kfly8/barefootjs-testing`,
      `${origin}/@${OWNER.handle}/${CITED}`,
    ),
  )
  const cookie = await ownerCookie()
  await publish(CITED, OWNER, cited, cookie)
  await publish(CITING, READER, citing, cookie)
  await seedEvent()
  console.log(`Cited deck:   ${origin}/@${OWNER.handle}/${CITED}`)
  console.log(`Citing deck:  ${origin}/@${READER.handle}/${CITING}`)
  console.log(`Owner cookie: ${cookie}`)
  if (process.argv.includes('--login')) {
    // Cookies ignore the port, so a helper on another port can hand the
    // browser the owner session before sending it to the Worker.
    const helper = createServer((_, response) => {
      response.writeHead(302, {
        'Set-Cookie': `${cookie}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=43200`,
        Location: `${origin}/slides/${CITED}/reactions`,
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
