import { describe, expect, test } from 'vitest'
import { IMAGE_RULES } from '../communities/image-policy'
import {
  DESCRIPTION_MAX,
  MAX_SITES,
  NAME_MAX,
} from '../communities/community-input'
import { MAX_COMMUNITY_LINKS } from '../communities/link-rules'
import { MAX_ARTICLE_CHARS } from '../articles/markdown'
import { CODE_ATTEMPTS, CODE_LENGTH, CODE_SECONDS } from '../auth/login-policy'
import { LINK_SCAN_BYTES } from '../citations/citation'
import { DECKS_SHOWN } from '../citations/citing'
import { MAX_SLUG_LENGTH } from '../decks/slug-name'
import { STASH_CONTINUE_MAX_AGE_MS, STASH_MAX_AGE_MS } from '../drops/stash'
import { HANDLE_HOLD_SECONDS } from '../handles/hold'
import { MAX_LINKS, MAX_TITLE_LENGTH } from '../links/link'
import { BIO_MAX, LINKS_MAX } from '../profile/profile-lines'
import { PICTURE_MAX_BYTES, PICTURE_SIDE } from '../profile/picture-policy'
import { VERSION_LIMITS } from '../uploads/version-limits'
import { DEFAULT_UPLOAD_LIMITS } from '../uploads/limits'
import { HOME_FOLLOWING_SHOWN } from '../site/home-shape'
import type { Lang } from '../site/i18n'
import { findArticle } from './catalog'
import { HELP_CATALOG } from './default-catalog'
import { helpNumbers } from './numbers'

/**
 * Where each section of the help before this rework went: the old section's id, and the articles that now hold what it said
 * (docs/dev/f36-help-frame.md has the same table). A section that held more
 * than one thing someone wants to do was split.
 */
export const MOVED_FROM = {
  login: [
    'start/sign-in',
    'start/invitation-only',
    'start/code-not-arrived',
    'account/change-email',
  ],
  profile: [
    'account/edit-profile',
    'account/profile-picture',
    'account/email-privacy',
  ],
  upload: [
    'slides/upload',
    'slides/accepted-files',
    'slides/limits',
    'slides/replace',
    'slides/url-name',
  ],
  article: [
    'articles/write',
    'articles/publish',
    'articles/embed-page',
    'articles/markdown',
    'agent/write-article-draft',
  ],
  links: ['articles/related-links'],
  pageShare: ['sharing/page-url', 'sharing/page-numbers'],
  citations: ['community/cite-slides', 'community/see-citations'],
  embed: ['sharing/embed-in-blog'],
  agent: ['agent/connect', 'agent/capabilities', 'agent/revoke'],
  follow: ['community/follow-people', 'community/unfollow'],
  events: [
    'community/list-event-talks',
    'community/event-names',
    'community/remove-event-talk',
  ],
  communities: [
    'community/create-community',
    'community/link-rules',
    'community/community-admins',
    'community/follow-community',
    'community/delete-community',
    'community/ask-us',
  ],
  block: ['safety/block-user', 'safety/block-vs-mute'],
  safety: ['safety/external-access'],
  terms: ['safety/terms'],
  privacy: ['safety/privacy'],
} as const

/** Text without the line breaks and spaces the formatter puts in markup. */
const squash = (text: string) => text.replace(/\s+/g, '')
const JAPANESE = /[぀-ヿ一-鿿]/
const MB = 1024 * 1024

async function articleText(key: string, lang: Lang) {
  const [aim, slug] = key.split('/')
  const entry = findArticle(HELP_CATALOG, aim!, slug!)
  if (!entry) throw new Error(`no article ${key}`)
  const text = entry.article[lang]
  const n = helpNumbers()
  return squash(
    `${text.title}${String(await text.lead(n))}${String(await text.body(n))}`,
  )
}

/** What the help said under one old section, now spread over its articles. */
async function section(id: keyof typeof MOVED_FROM, lang: Lang) {
  const parts = await Promise.all(
    MOVED_FROM[id].map((key) => articleText(key, lang)),
  )
  return parts.join('')
}

const everything = async (lang: Lang) =>
  (
    await Promise.all(
      Object.keys(MOVED_FROM).map((id) =>
        section(id as keyof typeof MOVED_FROM, lang),
      ),
    )
  ).join('')

const hasAll = (text: string, phrases: readonly string[]) => {
  for (const phrase of phrases) expect(text).toContain(squash(phrase))
}

/**
 * The articles written for the features of the fourth scope (work H2): they
 * did not come from a section of the help before. Add an article to this list
 * when it is not a section's move.
 */
export const ADDED_ARTICLES = [
  'account/before-leaving',
  'account/export-all',
  'account/export-slide',
  'account/reupload-zip',
  'agent/export-with-agent',
  'agent/reconnect',
  'safety/appeal',
  'safety/data-we-keep',
  'safety/hidden-slide',
  'safety/maintenance',
  'safety/operator',
  'safety/prohibited',
  'sharing/read-offline',
  'sharing/stored-version',
  'start/sign-up',
] as const

describe('the table of what moved where', () => {
  test('F36-AC10: Given every section the help had, When the table of what moved is read, Then each section has articles, every one exists, and every other article is one added since', () => {
    const named: string[] = Object.values(MOVED_FROM).flat()
    const keys = HELP_CATALOG.map((entry) => entry.key)
    for (const key of named) expect(keys).toContain(key)
    for (const key of Object.keys({ ...MOVED_FROM }))
      expect(MOVED_FROM[key as keyof typeof MOVED_FROM].length).toBeGreaterThan(
        0,
      )
    for (const key of ADDED_ARTICLES) expect(keys).toContain(key)
    expect(keys.filter((key) => !named.includes(key)).toSorted()).toEqual(
      [...ADDED_ARTICLES].toSorted(),
    )
    expect(new Set(named).size).toBe(named.length)
  })
})

describe('what the help said before, now in its articles', () => {
  test('F36-AC11: Given the upload limits, When the articles state them, Then every figure is the one the code enforces, in both languages', async () => {
    const versionMb = DEFAULT_UPLOAD_LIMITS.deploymentBytes / MB
    const fileMb = DEFAULT_UPLOAD_LIMITS.fileBytes / MB
    // The browser refuses a drop by VERSION_LIMITS, the service by its own
    // defaults; the help is true of both only while they agree.
    expect(VERSION_LIMITS.deploymentBytes).toBe(
      DEFAULT_UPLOAD_LIMITS.deploymentBytes,
    )
    expect(VERSION_LIMITS.fileBytes).toBe(DEFAULT_UPLOAD_LIMITS.fileBytes)
    expect(VERSION_LIMITS.files).toBe(DEFAULT_UPLOAD_LIMITS.files)
    const ja = await articleText('slides/limits', 'ja')
    hasAll(ja, [
      `1 つの版は ${versionMb} MB まで`,
      `1 つのファイルは ${fileMb} MB まで`,
      `1 つの版のファイルは ${DEFAULT_UPLOAD_LIMITS.files} 個まで`,
      `1 人が置けるスライドは ${DEFAULT_UPLOAD_LIMITS.decks} 本まで`,
      `${DEFAULT_UPLOAD_LIMITS.authorBytes / MB} MB まで`,
    ])
    const en = await articleText('slides/limits', 'en')
    hasAll(en, [
      `One version: up to ${versionMb} MB`,
      `One file: up to ${fileMb} MB`,
      `Files in one version: up to ${DEFAULT_UPLOAD_LIMITS.files}`,
    ])
    hasAll(await articleText('slides/accepted-files', 'ja'), [
      'HTML 1 ファイル',
      'zip',
      '1 つのフォルダの中に',
    ])
  })

  test('F36-AC11: Given the numbers beyond the upload limits, When the articles state them, Then each is the one the code uses, in both languages', async () => {
    const stashHours = STASH_MAX_AGE_MS / 3_600_000
    const minutes = STASH_CONTINUE_MAX_AGE_MS / 60_000
    const kb = LINK_SCAN_BYTES / 1024
    const ja = await everything('ja')
    hasAll(ja, [
      `${minutes} 分以内に戻ると、自動で受け取ります`,
      `${stashHours} 時間たつと捨てます`,
      `先頭の ${kb} KB までです`,
      `${DECKS_SHOWN} 件まで並べ`,
      `新しい順に ${HOME_FOLLOWING_SHOWN} 件まで`,
      `ハイフンで、${MAX_SLUG_LENGTH} 文字まで`,
      `本文は ${MAX_ARTICLE_CHARS.toLocaleString('en-US')} 文字まで`,
      `1 本のスライドに、${MAX_LINKS} 件まで`,
      `題名は ${MAX_TITLE_LENGTH} 文字まで`,
      `有効期限は ${CODE_SECONDS / 60} 分`,
      `入力を ${CODE_ATTEMPTS} 回間違えると`,
      `${CODE_LENGTH} 桁のコード`,
      `${PICTURE_MAX_BYTES / MB} MB までです`,
      `${PICTURE_SIDE}×${PICTURE_SIDE} に縮めてから送る`,
      `自己紹介(${BIO_MAX} 文字まで)`,
      `SNS のリンク(${LINKS_MAX} つまで)`,
      '1 から 200',
      '1 から 9999',
    ])
    const en = await everything('en')
    hasAll(en, [
      `return within ${minutes} minutes`,
      `discarded after ${stashHours} hours`,
      `the first ${kb} KB are read`,
      `Up to ${DECKS_SHOWN} are shown`,
      `the ${HOME_FOLLOWING_SHOWN} most recently published`,
      `up to ${MAX_SLUG_LENGTH} characters`,
      `up to ${MAX_ARTICLE_CHARS.toLocaleString('en-US')} characters`,
      `up to ${MAX_LINKS} links`,
      `works for ${CODE_SECONDS / 60} minutes`,
      `After ${CODE_ATTEMPTS} wrong tries`,
      `up to ${PICTURE_MAX_BYTES / MB} MB`,
      `${PICTURE_SIDE} × ${PICTURE_SIDE} before sending it`,
    ])
  })

  test('F36-AC10: Given the help’s English, When every article is read, Then no Japanese remains and the Japanese has Japanese', async () => {
    expect(await everything('en')).not.toMatch(JAPANESE)
    expect(await everything('ja')).toMatch(JAPANESE)
  })

  test('F36-AC10: Given the help in both languages, When GitHub is named, Then it is named only to say it is not a way to sign in', async () => {
    for (const [lang, said] of [
      ['ja', 'GitHub などほかのアカウントでのログインはありません'],
      ['en', 'no sign-in with GitHub or another account'],
    ] as const) {
      const text = await everything(lang)
      expect(text).toContain(squash(said))
      expect(text.replace(squash(said), '')).not.toContain('GitHub')
    }
  })

  test('F36-AC10: Given the articles, When they name the old screens, Then they use the current names of the edit page', async () => {
    for (const [lang, old, current] of [
      ['ja', '1 本の管理', 'スライドの編集'],
      ['en', 'manage page', 'edit page'],
    ] as const) {
      const text = await everything(lang)
      expect(text).not.toContain(squash(old))
      expect(text).toContain(squash(current))
    }
    for (const [lang, gone, present] of [
      [
        'ja',
        ['一般公開する', '版の履歴', '「差し替え」', '「埋め込みコード」の枠'],
        ['「公開する」', '「新しい版」'],
      ],
      [
        'en',
        [
          'history of versions',
          '“Replace”',
          '“Embed code” area',
          'Pause publishing',
        ],
        ['“Publish”', '“New version”'],
      ],
    ] as const) {
      const text = await everything(lang)
      for (const phrase of gone) expect(text).not.toContain(squash(phrase))
      hasAll(text, present)
    }
  })

  test('F36-AC10: Given the article on page numbers, When it describes a leading zero, Then it says it moves to the right spelling', async () => {
    hasAll(await everything('ja'), ['先頭に 0 を付けた番号は、正しい表記'])
    expect(await everything('en')).not.toContain(
      squash('Open in slide.community'),
    )
  })

  test('F36-AC10: Given the articles on sharing a page, citing, embedding, putting up from an agent and following, When they are read, Then each states what the implementation does and does not do', async () => {
    hasAll(await everything('ja'), [
      '/@ハンドル/URL の名前/6',
      '<code>#6</code>',
      'Marp',
      'このスライドを引用しているスライド',
      '両方が一般公開されている間だけ',
      '埋め込みコードをコピー',
      'フォロー、通報、ミュートができません',
      '公開すること、公開を止めること、削除すること',
      '接続を取り消す',
      'だれでも見られます',
    ])
  })

  test('F36-AC10: Given the articles on signing in, When they are read, Then they cover the code, the invitation, the limits, a mail that does not arrive, and a changed address', async () => {
    hasAll(await section('login', 'ja'), [
      'メールアドレスに送るコードだけ',
      '運営が登録したメールアドレスでだけ',
      '有効期限は',
      '回間違えると',
      '迷惑メールフォルダ',
      '受信箱に入れなくなったとき',
      'href="/contact"',
      '個別に対応します',
    ])
    hasAll(await section('login', 'en'), [
      'only by a code we email you',
      'Only email addresses the operators registered can sign in',
      'wrong tries',
      'spam folder',
      'href="/contact"',
      'individually',
    ])
  })

  test('F36-AC10: Given the articles on articles, When they are read, Then they cover where to write, draft and published, embedding a page, citations, what works, and a draft from an agent', async () => {
    hasAll(await section('article', 'ja'), [
      '記事の編集のページ',
      '自動で保存されます',
      '公開する',
      '公開記事を更新',
      '変更を取り消す',
      '記事の公開を止める',
      '段落の中でその URL だけで 1 行に書く',
      '引用として数えられます',
      'HTML と script は使えません',
      'CommonMark',
      'AI エージェント',
      '公開はできません',
      '「ビューアーで見る」を押すと',
      'まで、読者には見えません',
      '文の中に書いた URL は、ふつうのリンクになります',
      '自分のこのスライドのページは、いくつでも画像になります',
      '1 本の記事で 40 本のスライドまで画像になり',
      'いくつ書いても 1 本と数えます',
      'それより後のスライドのページは、ふつうのリンクになります',
    ])
    hasAll(await section('article', 'en'), [
      'article page',
      'saved by itself',
      'Update published article',
      'Undo changes',
      'Stop publishing the article',
      'alone on a line',
      'count as citations',
      'HTML and scripts do not work',
      'CommonMark',
      'cannot publish',
      '“View in viewer” at the top opens the page as readers will see it',
      'A URL written inside a sentence is a plain link',
      'Any number of pages of these slides become images',
      'for up to 40 slides in one article',
      'pages of slides written after those are plain links',
    ])
    // Pages a version lacks are no longer pointed out (F26-AC23 and F26-AC24
    // were deleted), and pages past the limit are not either.
    expect(await section('article', 'ja')).not.toContain(
      squash('編集のページでお知らせします'),
    )
    expect(await section('article', 'en')).not.toContain(
      squash('is pointed out on the article page'),
    )
  })

  test('F36-AC10: Given the article on related links, When it is read, Then it covers how to add one, the kinds, and the limit', async () => {
    hasAll(await section('links', 'ja'), [
      '「追加する」',
      '動画、記事、イベント、その他',
      '外す',
      '件までです',
    ])
    hasAll(await section('links', 'en'), [
      '“Add”',
      'Video, Article, Event and Other',
      'Remove',
      'up to',
    ])
  })

  test('F36-AC10: Given the articles on citations, When they are read, Then they say what the profile’s two lists hold and that a person’s own slides are not counted', async () => {
    hasAll(await section('citations', 'ja'), [
      '「引用した」には',
      '「引用された」には',
      '自分のスライド同士の引用は、プロフィールの一覧にも件数にも入りません',
    ])
    hasAll(await section('citations', 'en'), [
      '“Citing” lists',
      '“Cited” lists',
      'between a person’s own slides are in neither',
    ])
  })

  test('F36-AC10: Given the articles on the profile, When they are read, Then they name the fields, the order of pictures, and that the email address is hidden', async () => {
    const ja = await section('profile', 'ja')
    hasAll(ja, [
      '表示名',
      '自己紹介',
      '場所',
      'Web サイト',
      'SNS のリンク',
      'アップロードした画像。',
      'Gravatar の画像',
      '名前の頭文字',
      'メールアドレスは、ほかの人には見えません',
    ])
    // The order of the pictures, in the body of the article on the picture.
    const entry = findArticle(HELP_CATALOG, 'account', 'profile-picture')
    const picture = squash(String(await entry!.article.ja.body(helpNumbers())))
    const at = (phrase: string) => picture.indexOf(squash(phrase))
    expect(at('アップロードした画像。')).toBeLessThan(
      at('メールアドレスの Gravatar'),
    )
    expect(at('メールアドレスの Gravatar')).toBeLessThan(at('名前の頭文字'))
    hasAll(await section('profile', 'en'), [
      'Display name',
      'Bio',
      'Location',
      'Social links',
      'An image you upload',
      'Gravatar picture',
      'initial',
      'Nobody else can see your email address',
    ])
  })

  test.each([
    [
      'ja',
      [
        'イベントのページの URL を入れて「追加する」',
        '種類が「イベント」になります',
        'https://グループ名.connpass.com/event/番号/',
        'https://グループ名.doorkeeper.jp/events/番号',
        'https://luma.com/文字列',
        '一般公開中のスライドだけ',
        'イベントのページを取りに行きません',
        '最初に保存されたもの',
        '後から別の題名で足しても変わりません',
        'connpass のイベント 410635',
        '「外す」を押すか、種類を「イベント」からほかの種類に変えて',
      ],
    ],
    [
      'en',
      [
        'press “Add”',
        'get the kind Event',
        'https://group-name.connpass.com/event/number/',
        'https://group-name.doorkeeper.jp/events/number',
        'https://luma.com/name',
        'lists only public slides',
        'does not fetch the event’s page',
        'the title of the first saved related link',
        'Adding another title later does not change it',
        'connpass event 410635',
        'press “Remove” on the link, or change its kind from Event',
      ],
    ],
  ] as const)(
    'F36-AC10: Given the articles on event talks in %s, When they are read, Then they say that an event URL in the related links lists the slides, how the name is decided, and how to take them out',
    async (lang, phrases) => {
      hasAll(await section('events', lang), phrases)
    },
  )

  const HOLD_DAYS = HANDLE_HOLD_SECONDS / 86_400
  test.each([
    [
      'ja',
      [
        '<a href="/communities/new">コミュニティを作る</a>',
        `名前(${NAME_MAX} 文字まで)`,
        `${HOLD_DAYS} 日たっていないハンドルは使えません`,
        '作った人が管理者になり',
        `1 つ以上、${MAX_COMMUNITY_LINKS} 個まで`,
        'https://グループ名.connpass.com/',
        'https://グループ名.doorkeeper.jp/',
        'https://api.lu.ma/ics/get?entity=calendar&amp;id=cal-…',
        'https://ホスト名/',
        'だれでも使うサイトのリンクは入れられません',
        'どのコミュニティにも入りません',
        '1 本でもグループ名の付いたリンクがあれば、そのグループのコミュニティに入ります',
        `説明(${DESCRIPTION_MAX} 文字まで)`,
        `ロゴ(${IMAGE_RULES.logo.maxBytes / MB} MB まで)`,
        `カバー画像(${IMAGE_RULES.cover.maxBytes / MB} MB まで)`,
        `ほかのリンク(${MAX_SITES} つまで)`,
        'ハンドルで別の人を管理者に足せます',
        '最後の 1 人は外れられません',
        'スライドやフォロワーを外せません',
        'ハンドルを入力して「削除する」',
        'スライド、関連リンク、イベントのページは残ります',
        '<a href="/contact">お問い合わせ</a>',
        'ハンドルの変更',
        '管理者の移し替え',
        'イベント名の修正',
      ],
    ],
    [
      'en',
      [
        '<a href="/communities/new">Create a community</a>',
        `a name (up to ${NAME_MAX} characters)`,
        `less than ${HOLD_DAYS} days ago`,
        'You become its admin',
        `at least one, up to ${MAX_COMMUNITY_LINKS}`,
        'https://group-name.connpass.com/',
        'https://group-name.doorkeeper.jp/',
        'https://api.lu.ma/ics/get?entity=calendar&amp;id=cal-…',
        'https://host-name/',
        'A site everyone uses',
        'joins no community',
        'If even one link to it has a group name, it joins that group’s community',
        `its description (up to ${DESCRIPTION_MAX} characters)`,
        `its logo (up to ${IMAGE_RULES.logo.maxBytes / MB} MB)`,
        `its cover image (up to ${IMAGE_RULES.cover.maxBytes / MB} MB)`,
        `its other links (up to ${MAX_SITES})`,
        'add another person as an admin by their handle',
        'The last admin cannot leave',
        'cannot remove slides or followers',
        'types the community’s handle and presses “Delete”',
        'Slides, related links and event pages stay',
        '<a href="/contact">Contact</a>',
        'A new handle',
        'Moving the admins',
        'Fixing an event’s name',
      ],
    ],
  ] as const)(
    'F36-AC10: Given the articles on communities in %s, When they are read, Then they cover making one, its links, admins, deleting, and what to ask the service for',
    async (lang, phrases) => {
      hasAll(await section('communities', lang), phrases)
    },
  )

  test.each([
    [
      'ja',
      [
        '互いのフォローが外れ',
        'お知らせも届かず',
        'コミュニティのフォローは止まりません',
        'ブロックしたことは、相手に知らせません',
        'ミュートで外れるのは、あなたから相手へのフォローだけ',
        '「ブロックしている人」で、相手の「ブロックを解除」',
        '外れたフォローは戻りません',
      ],
    ],
    [
      'en',
      [
        'You stop following each other',
        'get no notification',
        'Community follows stay as they are',
        'They are not told',
        'Muting ends only your follow of them',
        'Under “People you blocked” in the settings, press “Unblock”',
        'Follows that ended do not come back',
      ],
    ],
  ] as const)(
    'F36-AC10: Given the articles on blocking in %s, When they are read, Then they say what blocking does, how it differs from muting, and how to unblock',
    async (lang, phrases) => {
      hasAll(await section('block', lang), phrases)
    },
  )

  test('F36-AC10: Given the article on opening slides from someone you do not know, When it is read, Then it says what slides cannot do, that they talk to other sites, and not to type a password', async () => {
    hasAll(await section('safety', 'ja'), [
      '別のタブやウィンドウを開く',
      'スライドは外部と通信できます。',
      'パスワードを入力しないでください。',
    ])
    hasAll(await section('safety', 'en'), [
      'Opening other tabs or windows',
      'Slides can talk to other sites.',
      'do not type your password',
    ])
  })

  test('F36-AC10: Given the articles on the terms and the privacy policy, When they are read, Then each links to its page', async () => {
    hasAll(await section('terms', 'ja'), ['<a href="/terms">'])
    hasAll(await section('privacy', 'ja'), ['<a href="/privacy">'])
    hasAll(await section('terms', 'en'), ['<a href="/terms">'])
    hasAll(await section('privacy', 'en'), ['<a href="/privacy">'])
  })
})
