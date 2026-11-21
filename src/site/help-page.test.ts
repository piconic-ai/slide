import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { testEnv, TEST_ORIGIN } from '../publication/test-support'
import { VERSION_LIMITS } from '../uploads/version-limits'
import { DEFAULT_UPLOAD_LIMITS } from '../uploads/limits'
import { HELP_PAGE_POLICY } from './help-page'
import { HELP_SECTION_IDS } from './help-content'
import { LINK_SCAN_BYTES } from '../citations/citation'
import { DECKS_SHOWN } from '../citations/citing'
import { MAX_SLUG_LENGTH } from '../decks/slug-name'
import { STASH_CONTINUE_MAX_AGE_MS, STASH_MAX_AGE_MS } from '../drops/stash'
import { HOME_FOLLOWING_SHOWN } from './home-shape'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
afterAll(() => platform.dispose())

const get = (path: string, vars: Env = env) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`), vars)

test('F17-AC5: Given a reader, When the help is requested, Then it explains what every slide can and cannot do and may be indexed', async () => {
  const response = await get('/help')
  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Security-Policy')).toBe(HELP_PAGE_POLICY)
  expect(response.headers.get('X-Robots-Tag')).toBeNull()
  expect(response.headers.get('Link')).toContain(
    `<${TEST_ORIGIN}/help?lang=en>; rel="alternate"; hreflang="en"`,
  )
  const page = await response.text()
  expect(page).toContain('<h1>ヘルプ</h1>')
  expect(page).toContain('line-height: 1.9')
  expect(page).toContain('<section id="safety">')
  expect(page).toContain('別のタブやウィンドウを開く')
  expect(page).toContain('スライドは外部と通信できます。')
  // Nothing is listed per slide, so nothing explains how to read a list.
  expect(page).not.toContain('通信先」の読み方')
  expect(page).toContain('パスワードを入力しないでください。')
})

test('Given a reader who reads English, When the help is requested, Then it is in English', async () => {
  const page = await (await get('/help?lang=en')).text()
  expect(page).toContain('<html lang="en">')
  expect(page).toContain('<h1>Help</h1>')
  expect(page).toContain('<section id="safety">')
  expect(page).toContain('Opening other tabs or windows')
  expect(page).toContain('Slides can talk to other sites.')
  expect(page).toContain('do not type your password')
  expect(page).not.toContain('別のタブ')
})

test('Given maintenance, When the help is requested, Then it is still served', async () => {
  const response = await get('/help', { ...env, MAINTENANCE: 'on' } as Env)
  expect(response.status).toBe(200)
  expect(await response.text()).toContain('<h1>ヘルプ</h1>')
})

test('Given a path under the help that does not exist, When it is requested, Then it is not found', async () => {
  expect((await get('/help/missing')).status).toBe(404)
})

const TOC_JA = [
  '置き方',
  'ページごとの共有',
  '引用',
  'ブログへの埋め込み',
  'AI エージェントから置く',
  'フォロー',
  '安全について',
  '規約',
  'プライバシー',
]
const TOC_EN = [
  'Putting slides up',
  'Sharing a page',
  'Citations',
  'Embedding in a blog',
  'Putting up from an AI agent',
  'Following',
  'Safety',
  'Terms',
  'Privacy',
]

/** The table of contents' links, then each section's heading, in order. */
function outline(page: string) {
  const toc = /<nav class="help-toc"[\s\S]*?<\/nav>/.exec(page)?.[0] ?? ''
  return {
    toc: [...toc.matchAll(/<a href="#([^"]+)">([^<]+)<\/a>/g)].map((m) => [
      m[1],
      m[2],
    ]),
    sectionIds: [...page.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]),
  }
}

test('F03-AC20: Given a reader, When the help is requested, Then the table of contents lists the nine items in order and each one links to the section that is there', async () => {
  const page = await (await get('/help')).text()
  const { toc, sectionIds } = outline(page)
  expect(toc).toEqual(HELP_SECTION_IDS.map((id, i) => [id, TOC_JA[i]]))
  expect(sectionIds).toEqual([...HELP_SECTION_IDS])
  for (const id of HELP_SECTION_IDS) expect(page).toContain(`id="${id}"`)
  // Each section has exactly one h2, and the ones the help does not own say
  // where the real text is.
  expect(page.match(/<h2>/g)).toHaveLength(HELP_SECTION_IDS.length)
  expect(page).toContain('<a href="/terms">')
  expect(page).toContain('<a href="/privacy">')
})

test('F03-AC20: Given the pages that link to the help, When their links are read, Then none points at a section that is gone', async () => {
  // The footer links to the page itself, never to a section of it.
  const footer = await (await get('/terms')).text()
  expect(footer).toContain('<a href="/help">ヘルプ</a>')
  expect(footer).not.toMatch(/href="\/help#/)
})

test('F03-AC21: Given the upload limits, When the help states them, Then every figure is the one the code enforces, and the forms it accepts are named', async () => {
  const { versionMb, fileMb } = {
    versionMb: DEFAULT_UPLOAD_LIMITS.deploymentBytes / 1024 / 1024,
    fileMb: DEFAULT_UPLOAD_LIMITS.fileBytes / 1024 / 1024,
  }
  // The browser refuses a drop by VERSION_LIMITS, the service by its own
  // defaults; the help is true of both only while they agree.
  expect(VERSION_LIMITS.deploymentBytes).toBe(
    DEFAULT_UPLOAD_LIMITS.deploymentBytes,
  )
  expect(VERSION_LIMITS.fileBytes).toBe(DEFAULT_UPLOAD_LIMITS.fileBytes)
  expect(VERSION_LIMITS.files).toBe(DEFAULT_UPLOAD_LIMITS.files)
  const page = await (await get('/help')).text()
  expect(page).toContain(`1 つの版は ${versionMb} MB まで`)
  expect(page).toContain(`1 つのファイルは ${fileMb} MB まで`)
  expect(page).toContain(
    `1 つの版のファイルは ${DEFAULT_UPLOAD_LIMITS.files} 個まで`,
  )
  expect(page).toContain(
    `1 人が置けるスライドは ${DEFAULT_UPLOAD_LIMITS.decks} 本まで`,
  )
  expect(page).toContain(
    `${DEFAULT_UPLOAD_LIMITS.authorBytes / 1024 / 1024} MB まで`,
  )
  const english = await (await get('/help?lang=en')).text()
  expect(english).toContain(`One version: up to ${versionMb} MB`)
  expect(english).toContain(`One file: up to ${fileMb} MB`)
  expect(english).toContain(
    `Files in one version: up to ${DEFAULT_UPLOAD_LIMITS.files}`,
  )
  // The forms, and the zip rule.
  expect(page).toContain('HTML 1 ファイル')
  expect(page).toContain('zip')
  expect(page).toContain('1 つのフォルダの中に')
  // The invitation comes first in the section on putting slides up.
  const upload = page.slice(page.indexOf('<section id="upload">'))
  expect(upload.indexOf('招待制')).toBeGreaterThan(-1)
  expect(upload.indexOf('招待制')).toBeLessThan(upload.indexOf('置けるもの'))
})

test('F03-AC22: Given a reader who reads English, When the help is requested, Then the same nine sections are in English and no Japanese remains in the page', async () => {
  const page = await (await get('/help?lang=en')).text()
  const { toc, sectionIds } = outline(page)
  expect(toc).toEqual(HELP_SECTION_IDS.map((id, i) => [id, TOC_EN[i]]))
  expect(sectionIds).toEqual([...HELP_SECTION_IDS])
  expect(page).toContain('Slide is invite-only for now.')
  expect(page).toContain('Copy link to this page')
  expect(page).toContain('Disconnect')
  const main = /<main[\s\S]*<\/main>/.exec(page)?.[0] ?? ''
  expect(main).not.toMatch(/[\u3040-\u30ff\u4e00-\u9fff]/)
})

test('F03-AC20: Given the sections on sharing a page, citing, embedding, putting up from an agent and following, When they are read, Then each states what the implementation does and does not do', async () => {
  const page = await (await get('/help')).text()
  // Sharing a page: the form of the URL, the condition, and the range.
  expect(page).toContain('/@ハンドル/URL の名前/6')
  expect(page).toContain('<code>#6</code>')
  expect(page).toContain('Marp')
  expect(page).toContain('1 から 200')
  expect(page).toContain('1 から 9999')
  // Citations: where they show and when they go.
  expect(page).toContain('このスライドを引用しているスライド')
  expect(page).toContain('両方が一般公開されている間だけ')
  // Embedding: the menu, what stays out of the frame.
  expect(page).toContain('埋め込みコードをコピー')
  expect(page).toContain('フォロー、通報、ミュートができません')
  // Agents: no publishing, no zip, how to revoke.
  expect(page).toContain('公開すること、公開を止めること、削除すること')
  expect(page).toContain('zip')
  expect(page).toContain('接続を取り消す')
  // Following: the lists are public.
  expect(page).toContain('だれでも見られます')
})

/** Text without the line breaks and spaces the formatter puts in markup. */
const squash = (text: string) => text.replace(/\s+/g, '')

test('F03-AC21: Given the numbers beyond the upload limits, When the help states them, Then each is the one the code uses, in both languages', async () => {
  const stashHours = STASH_MAX_AGE_MS / 3_600_000
  const minutes = STASH_CONTINUE_MAX_AGE_MS / 60_000
  const kb = LINK_SCAN_BYTES / 1024
  const ja = squash(await (await get('/help')).text())
  expect(ja).toContain(squash(`${minutes} 分以内に戻ると、自動で受け取ります`))
  expect(ja).toContain(squash(`${stashHours} 時間たつと捨てます`))
  expect(ja).toContain(squash(`先頭の ${kb} KB までです`))
  expect(ja).toContain(squash(`${DECKS_SHOWN} 件まで並べ`))
  expect(ja).toContain(squash(`新しい順に ${HOME_FOLLOWING_SHOWN} 件まで`))
  expect(ja).toContain(squash(`ハイフンで、${MAX_SLUG_LENGTH} 文字まで`))
  const en = squash(await (await get('/help?lang=en')).text())
  expect(en).toContain(squash(`return within ${minutes} minutes`))
  expect(en).toContain(squash(`discarded after ${stashHours} hours`))
  expect(en).toContain(squash(`the first ${kb} KB are read`))
  expect(en).toContain(squash(`Up to ${DECKS_SHOWN} are shown`))
  expect(en).toContain(
    squash(`the ${HOME_FOLLOWING_SHOWN} most recently published`),
  )
  expect(en).toContain(squash(`up to ${MAX_SLUG_LENGTH} characters`))
})

test('F03-AC20: Given a page number with a leading zero, When the help describes it, Then it says it moves to the right spelling, and the embed and safety references name headings that exist', async () => {
  const ja = squash(await (await get('/help')).text())
  expect(ja).toContain(squash('先頭に 0 を付けた番号は、正しい表記'))
  expect(ja).toContain(squash('知らない人のスライドを開くとき'))
  expect(ja).not.toContain(squash('「安全について」を読んでください'))
  const en = squash(await (await get('/help?lang=en')).text())
  expect(en).not.toContain(squash('Open in Slide'))
  expect(en).toContain(
    squash('Read “Opening slides from someone you do not know”'),
  )
})

test.each([
  ['/help', '1 本の管理', 'スライドの編集'],
  ['/help?lang=en', 'manage page', 'edit page'],
])(
  'F03-AC66: Given the help %s, When it is read, Then it names the editing of slides and not the old “%s” name',
  async (path, old, current) => {
    const page = (await (await get(path)).text()).replace(/\s+/g, ' ')
    expect(page).not.toContain(old)
    expect(page).not.toMatch(/1\s*本の管理/)
    expect(page).toContain(current)
  },
)

test.each([
  [
    'ja',
    '/help',
    ['一般公開する', '版の履歴', '「差し替え」', '「埋め込みコード」の枠'],
    ['「公開する」', '「新しい版」'],
  ],
  [
    'en',
    '/help?lang=en',
    [
      'history of versions',
      '“Replace”',
      '“Embed code” area',
      'Pause publishing',
    ],
    ['“Publish”', '“New version”'],
  ],
] as const)(
  'F25-AC11: Given the help in %s, When it names the buttons of the edit page, Then it uses the screen’s words and sends embedding to the viewer’s share menu only',
  async (_, path, gone, present) => {
    const page = (await (await get(path)).text()).replace(/\s+/g, ' ')
    for (const phrase of gone) expect(page).not.toContain(phrase)
    for (const phrase of present) expect(page).toContain(phrase)
  },
)
