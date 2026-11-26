// Seeds a local Worker with the data the sixteen screens of scope 4 are shot
// with (docs/dev/scope4-integration.md): about twelve public slides, one of
// them with a published version and a newer ready one, two published
// articles, two communities, twelve weeks of daily counts, five alerts, a
// backup record and one planned maintenance. Local only: the slides go
// through the real upload routes with the owner's session, and everything
// else is written to the local D1 with wrangler. A non-local origin is
// refused, and nothing here reaches a network other than that origin.
//
//   SLIDE_PERSIST_TO=<state directory> node scripts/demo-scope4.mjs [origin]
//
// Prints the owner's cookie. Run it again on a fresh state directory; slides
// that exist are uploaded to again, and the rows that are not slides are
// replaced, not doubled.
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { profileSql } from './demo-profiles.mjs'
import { ownerSessionSql, signOwnerCookie } from './owner-cookie.mjs'

const originArgument = process.argv.slice(2).find((a) => !a.startsWith('--'))
const origin = originArgument ?? 'http://localhost:8811'
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
  throw new Error('Local demo only: refusing a non-local origin')

const OWNER = { id: '722500', handle: 'kfly8' }
const READER = { id: '900001', handle: 'demo-reader' }
/** Must match BETTER_AUTH_SECRET of the local Worker; never used elsewhere. */
const SECRET =
  process.env.BETTER_AUTH_SECRET ?? 'local-demo-only-better-auth-secret-000000'
const persistTo = process.env.SLIDE_PERSIST_TO

const quote = (value) =>
  value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`
const now = Math.floor(Date.now() / 1000)
const DAY = 86400
const temporary = await mkdtemp(join(tmpdir(), 'slide-demo-scope4-'))

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

/** The slides: [slug, author, title, one line the viewer shows]. */
const SLIDES = [
  ['intro-to-slide', OWNER, 'Slide をはじめよう', 'HTML のスライドを公開する'],
  ['testing-ui', OWNER, 'UI のテストを育てる', '六つのテスト技法の事例'],
  [
    'edge-workers',
    OWNER,
    'Workers で作る小さなサービス',
    'D1 と R2 の使いどころ',
  ],
  ['html-slides', OWNER, 'HTML だけで作るスライド', '道具を選ばずに置く'],
  [
    'two-versions',
    OWNER,
    '版が二つあるスライド',
    '公開中の版と、準備済みの新しい版',
  ],
  ['design-notes', OWNER, 'DESIGN.md を読む', '白地と墨の文字だけで作る'],
  ['lt-5min', OWNER, '5 分のライトニングトーク', '短く話して、あとは記事に'],
  ['accessibility', OWNER, 'キーボードだけで使える画面', '44px の押せる範囲'],
  ['cloudflare-tips', OWNER, 'Cloudflare 小ネタ集', 'Cron と ratelimit のメモ'],
  ['reader-notes', READER, '引用のしかた', '他の人のページを自分のスライドに'],
  ['community-meetup', READER, '勉強会の運営メモ', 'connpass と Luma をつなぐ'],
  [
    'offline-reading',
    READER,
    '電波がないときのスライド',
    '保存した版を読む仕組み',
  ],
]

const slideHtml = ([, , title, line], version) => `<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="description" content="${line}">
<style>body{margin:0;font-family:system-ui,sans-serif;background:#fff;color:#111}
main{max-width:900px;margin:auto;padding:12vh 7vw}h1{font-size:clamp(32px,6vw,72px)}p{font-size:clamp(18px,2.6vw,32px);color:#444}
section[hidden]{display:none}</style>
<main><section><h1>${title}</h1><p>${line}${version > 1 ? '(第 2 版)' : ''}</p></section>
<section hidden><h1>2 枚目</h1><p>${line}</p></section></main>`

/** A session of the owner, as Better Auth signs its cookie. */
async function ownerCookie() {
  const token = randomUUID().replaceAll('-', '')
  await execute(
    ownerSessionSql({
      userId: OWNER.id,
      email: `${OWNER.handle}@local.example`,
      name: OWNER.handle,
      token,
      now: Date.now(),
    }),
  )
  return signOwnerCookie(token, SECRET)
}

/** Sends the slide as a new version, through the real upload routes; the deployment id. */
async function upload(slug, html, cookie) {
  const directory = join(temporary, `${slug}-${randomUUID()}`)
  await mkdir(directory)
  await writeFile(join(directory, 'index.html'), html)
  const output = execFileSync(
    process.execPath,
    ['scripts/upload.mjs', directory, origin],
    {
      env: { ...process.env, SLIDE_ID: slug, SLIDE_OWNER_COOKIE: cookie },
      encoding: 'utf8',
    },
  )
  const { deploymentId, state } = JSON.parse(output)
  if (state !== 'ready' || !/^[0-9a-f-]{36}$/.test(deploymentId))
    throw new Error(`Upload of ${slug} did not become ready`)
  return deploymentId
}

async function putUp(slide, cookie) {
  const [slug, author] = slide
  await execute(
    `INSERT INTO accounts (user_id,handle,created_at) VALUES (${quote(author.id)},${quote(author.handle)},${now - 40 * DAY})
      ON CONFLICT DO NOTHING;
    INSERT INTO decks (id,slug,owner_user_id,created_at) VALUES (${quote(slug)},${quote(slug)},${quote(OWNER.id)},${now})
      ON CONFLICT DO NOTHING;
    UPDATE decks SET owner_user_id = ${quote(OWNER.id)} WHERE id = ${quote(slug)};
    ${profileSql(author.id)}`,
  )
  const id = await upload(slug, slideHtml(slide, 1), cookie)
  // The author would press Publish on the manage page; the demo points the
  // slide at the new version directly, then hands it to its author.
  await execute(
    `UPDATE decks SET public_deployment_id = ${quote(id)}, paused_at = NULL,
      resume_deployment_id = NULL, revision = revision + 1,
      first_published_at = COALESCE(first_published_at, ${now}),
      owner_user_id = ${quote(author.id)} WHERE id = ${quote(slug)};`,
  )
  return id
}

/** Two published articles, in Markdown; a draft stays out of the lists. */
const ARTICLES = [
  [
    'intro-to-slide',
    `# Slide をはじめよう\n\nHTML のスライドを置くと、そのまま公開できます。\n\n## 手順\n\n1. ビルドしたファイルを用意します。\n2. 「アップロード」から置きます。\n3. 準備ができたら「公開」を押します。\n`,
  ],
  [
    'two-versions',
    `# 版が二つあるスライド\n\n公開中の版と、準備済みの新しい版の違いを書いた記事です。\n\n## 手順\n\n1. 新しい版を置きます。\n2. 「この版を公開する」を押します。\n`,
  ],
]

/** Two communities, each with its run by the owner. */
const COMMUNITIES = [
  [
    101,
    'tokyo-html-slides',
    'Tokyo HTML Slides',
    'green',
    'HTML でスライドを作る人の集まりです。',
  ],
  [
    102,
    'workers-meetup',
    'Workers Meetup',
    'navy',
    'Cloudflare Workers の勉強会です。',
  ],
]

/** Twelve weeks of daily counts, every event the table reads, ending today. */
function metricRows() {
  const rows = []
  const add = (day, event, detail, referrer, lang, screen, events, valueSum) =>
    rows.push(
      `(${quote(day)},${quote(event)},${quote(detail)},${quote(referrer)},${quote(lang)},${quote(screen)},${events},${valueSum})`,
    )
  for (let back = 0; back < 84; back++) {
    const day = new Date((now - back * DAY) * 1000).toISOString().slice(0, 10)
    // Grows toward today, with a weekly rhythm.
    const level = 3 + Math.floor((84 - back) / 12) + (back % 7 === 0 ? 1 : 0)
    add(day, 'upload_started', '', '', 'ja', '', level + 2, 0)
    add(day, 'upload_finished', '', '', 'ja', '', level + 1, 0)
    add(day, 'deck_published', '', '', 'ja', '', level, level * 420)
    add(day, 'deck_opened', 'page', '', 'ja', '', level * 12, 0)
    add(day, 'deck_opened', 'page', 'internal', 'ja', '', level * 5, 0)
    add(day, 'deck_opened', 'page', 'x.com', 'ja', '', level * 3, 0)
    add(day, 'deck_opened', 'page', 'connpass.com', 'ja', '', level * 2, 0)
    add(day, 'deck_opened', 'embed', 'zenn.dev', 'ja', '', level * 2, 0)
    add(day, 'login_code_sent', '', '', 'ja', '', level + 4, 0)
    add(day, 'login_code_entered', 'accepted', '', 'ja', '', level + 2, 0)
    add(day, 'login_code_entered', 'rejected', '', 'ja', '', 1, 0)
    if (back % 3 === 0)
      add(day, 'upload_refused', 'file_too_large', '', 'ja', '', 1, 0)
    if (back % 5 === 0)
      add(day, 'upload_refused', 'too_many_files', '', 'ja', '', 1, 0)
    if (back % 2 === 0) add(day, 'article_published', '', '', 'ja', '', 1, 0)
    if (back % 4 === 0) add(day, 'related_link_added', '', '', 'ja', '', 1, 0)
    if (back % 6 === 0) add(day, 'citation_made', '', '', 'ja', '', 1, 0)
    if (back % 6 === 1) add(day, 'community_followed', '', '', 'ja', '', 2, 0)
    if (back % 9 === 0)
      add(day, 'export_downloaded', 'slide', '', 'ja', '', 1, 0)
    if (back % 9 === 3)
      add(day, 'export_downloaded', 'account', '', 'ja', '', 1, 0)
    if (back % 2 === 1)
      add(day, 'mcp_tool_called', 'list_slides', '', 'ja', '', 2, 0)
    if (back % 4 === 1)
      add(day, 'mcp_tool_called', 'put_slide', '', 'ja', '', 1, 0)
    if (back % 3 === 1)
      add(
        day,
        'help_article_viewed',
        'account/reupload-zip',
        '',
        'ja',
        '',
        3,
        0,
      )
    if (back % 3 === 2) add(day, 'help_search_empty', 'zip', '', 'ja', '', 1, 0)
    if (back % 8 === 0)
      add(day, 'help_to_contact', 'account/reupload-zip', '', 'ja', '', 1, 0)
    if (back % 10 === 0)
      add(day, 'screen_error', 'not_found', '', 'ja', '/@:handle/:slug', 2, 0)
  }
  return rows
}

try {
  const cookie = await ownerCookie()
  for (const slide of SLIDES) await putUp(slide, cookie)

  // A second version of one slide, newer than the published one: it stays
  // ready until its author publishes it.
  const twice = SLIDES.find(([slug]) => slug === 'two-versions')
  await upload('two-versions', slideHtml(twice, 2), cookie)

  const articleSql = ARTICLES.map(
    ([
      deck,
      body,
    ]) => `INSERT INTO articles (deck_id,body,status,revision,created_at,updated_at)
      VALUES (${quote(deck)},${quote(body)},'published',1,${now - 3 * DAY},${now - 2 * DAY})
      ON CONFLICT (deck_id) DO UPDATE SET body = excluded.body, status = 'published';`,
  )
  const communitySql = COMMUNITIES.flatMap(
    ([id, handle, name, color, text]) => [
      `INSERT OR REPLACE INTO communities (id,name,description,color,sites,created_at)
      VALUES (${id},${quote(name)},${quote(text)},${quote(color)},'[]',${now - 20 * DAY});`,
      `INSERT OR REPLACE INTO handles (handle,owner_kind,owner_id,created_at)
      VALUES (${quote(handle)},'community',${quote(String(id))},${now - 20 * DAY});`,
      `INSERT OR REPLACE INTO community_admins (community_id,user_id,added_at)
      VALUES (${id},${quote(OWNER.id)},${now - 20 * DAY});`,
    ],
  )

  // Counts: sign-ups in the last hours (the operations page's own counts),
  // twelve weeks of daily counts, and one row for each copied day.
  const signups = [
    ['910001', 'new-author-a', now - 600],
    ['910002', 'new-author-b', now - 5 * 3600],
    ['910003', 'new-author-c', now - 20 * 3600],
  ].map(
    ([id, handle, at]) =>
      `INSERT OR IGNORE INTO accounts (user_id,handle,created_at) VALUES (${quote(id)},${quote(handle)},${at});`,
  )
  const days = Array.from({ length: 84 }, (_, back) =>
    new Date((now - back * DAY) * 1000).toISOString().slice(0, 10),
  )
  const metrics = metricRows()
  const metricSql = [
    'DELETE FROM metric_daily;',
    'DELETE FROM metric_days;',
    // One statement for each batch of rows keeps each under D1's limits.
    ...Array.from(
      { length: Math.ceil(metrics.length / 100) },
      (_, i) =>
        `INSERT OR REPLACE INTO metric_daily (day,event,detail,referrer,lang,screen,events,value_sum) VALUES ${metrics.slice(i * 100, i * 100 + 100).join(',')};`,
    ),
    ...days.map(
      (day) =>
        `INSERT OR REPLACE INTO metric_days (day,copied_at,row_count,was_cut) VALUES (${quote(day)},${now - 3600},20,0);`,
    ),
  ]

  // Five alerts: kind, urgency, count, link, task, phase, minutes ago, state.
  const alertRows = [
    [
      'login_mail_failed',
      'immediate',
      6,
      '/operations#alerts',
      null,
      null,
      25,
      'sent',
    ],
    [
      'maintenance',
      'immediate',
      0,
      '/operations#maintenance',
      null,
      'started',
      180,
      'sent',
    ],
    [
      'signup_surge',
      'immediate',
      14,
      '/operations#signups',
      null,
      null,
      600,
      'sent',
    ],
    [
      'cron_failed',
      'next_day',
      2,
      '/operations#alerts',
      'backup',
      null,
      1500,
      'queued',
    ],
    [
      'backup_failed',
      'next_day',
      1,
      '/operations#backups',
      null,
      null,
      2200,
      'queued',
    ],
  ].map(
    ([kind, urgency, count, link, task, phase, ago, state]) =>
      `INSERT INTO alerts (kind,urgency,count,link,task,phase,raised_at,state)
        VALUES (${quote(kind)},${quote(urgency)},${count},${quote(link)},${quote(task)},${quote(phase)},${now - ago * 60},${quote(state)});`,
  )

  // A backup that finished a day ago and failed to copy one object since.
  const backupSql = [
    ...Array.from(
      { length: 7 },
      (_, i) =>
        `INSERT OR REPLACE INTO backup_objects (key,etag,size,copied_at,gone_at)
          VALUES (${quote(`d1/${i}/index.html`)},'etag',${2048 * (i + 1)},${now - DAY + i * 60},${i === 6 ? now - 2 * DAY : 'NULL'});`,
    ),
    `UPDATE backup_state SET last_pass_started_at = ${now - DAY - 600}, last_completed_at = ${now - DAY},
      progress_at = ${now - DAY}, last_run_at = ${now - 3600}, last_run_failed = 1, last_failed_at = ${now - 3600}
      WHERE id = 1;`,
  ]

  // One planned maintenance, a few days ahead.
  const noticeSql = `INSERT OR REPLACE INTO maintenance_notice (id,starts_at,ends_at,reason,updated_at)
    VALUES (1,${now + 3 * DAY},${now + 3 * DAY + 2 * 3600},'update',${now});`

  await execute(
    [
      ...articleSql,
      ...communitySql,
      ...signups,
      ...metricSql,
      'DELETE FROM alerts;',
      ...alertRows,
      ...backupSql,
      noticeSql,
    ].join('\n'),
  )

  console.log(
    `Slides:       ${SLIDES.length} (${origin}/@${OWNER.handle}/intro-to-slide)`,
  )
  console.log(`Owner cookie: ${cookie}`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
