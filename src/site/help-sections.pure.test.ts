import { expect, test } from 'vitest'
import {
  DESCRIPTION_MAX,
  MAX_SITES,
  NAME_MAX,
} from '../communities/community-input'
import { IMAGE_RULES } from '../communities/image-policy'
import { MAX_COMMUNITY_LINKS } from '../communities/link-rules'
import {
  emptyNewCommunityForm,
  newCommunityBody,
} from '../communities/new-page'
import { HANDLE_HOLD_SECONDS } from '../handles/hold'
import {
  HELP_SECTION_IDS,
  helpSectionPath,
  helpSections,
  type HelpSectionId,
} from './help-content'
import type { Lang } from './i18n'

const squash = (text: string) => text.replace(/\s+/g, '')
const JAPANESE = /[\u3040-\u30ff\u4e00-\u9fff]/

async function sectionText(lang: Lang, id: HelpSectionId) {
  const section = helpSections(lang).find((s) => s.id === id)
  if (!section) throw new Error(`no section ${id}`)
  return { title: section.title, body: squash(String(await section.body)) }
}

const MB = 1024 * 1024
const HOLD_DAYS = HANDLE_HOLD_SECONDS / 86_400

test('Given the help, When its sections are listed, Then the event and community sections come after following and before safety', () => {
  const ids = [...HELP_SECTION_IDS]
  expect(ids.slice(ids.indexOf('follow'), ids.indexOf('safety') + 1)).toEqual([
    'follow',
    'events',
    'communities',
    'safety',
  ])
})

test.each([
  [
    'ja',
    'イベントの発表',
    [
      'イベントのページの URL を入れて「追加する」',
      '種類が「イベント」になります',
      'https://グループ名.connpass.com/event/番号/',
      'https://グループ名.doorkeeper.jp/events/番号',
      'https://luma.com/文字列',
      '一般公開中のスライドだけ',
      'イベントのページを取りに行きません',
      // How the name is decided.
      '最初に保存されたもの',
      '後から別の題名で足しても変わりません',
      'connpass のイベント 410635',
      // How to take slides out.
      '「外す」を押すか、種類を「イベント」からほかの種類に変えて',
    ],
  ],
  [
    'en',
    'Event talks',
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
  'F29-AC26: Given the help in %s, When the section on event talks is read, Then it says that an event URL in the related links lists the slides, how the name is decided, and how to take them out',
  async (lang, title, phrases) => {
    const section = await sectionText(lang, 'events')
    expect(section.title).toBe(title)
    for (const phrase of phrases) expect(section.body).toContain(squash(phrase))
    if (lang === 'en') expect(section.body).not.toMatch(JAPANESE)
  },
)

test.each([
  [
    'ja',
    'コミュニティ',
    [
      // Making one.
      '<a href="/communities/new">コミュニティを作る</a>',
      `名前(${NAME_MAX} 文字まで)`,
      `${HOLD_DAYS} 日たっていないハンドルは使えません`,
      '作った人が管理者になり',
      // The links.
      `1 つ以上、${MAX_COMMUNITY_LINKS} 個まで`,
      'https://グループ名.connpass.com/',
      'https://グループ名.doorkeeper.jp/',
      'https://api.lu.ma/ics/get?entity=calendar&amp;id=cal-…',
      'https://ホスト名/',
      'だれでも使うサイトのリンクは入れられません',
      'どのコミュニティにも入りません',
      // Admins.
      `説明(${DESCRIPTION_MAX} 文字まで)`,
      `ロゴ(${IMAGE_RULES.logo.maxBytes / MB} MB まで)`,
      `カバー画像(${IMAGE_RULES.cover.maxBytes / MB} MB まで)`,
      `ほかのリンク(${MAX_SITES} つまで)`,
      'ハンドルで別の人を管理者に足せます',
      '最後の 1 人は外れられません',
      'スライドやフォロワーを外せません',
      // Deleting.
      'ハンドルを入力して「削除する」',
      'スライド、関連リンク、イベントのページは残ります',
      // What to ask for.
      '<a href="/contact">お問い合わせ</a>',
      'ハンドルの変更',
      '管理者の移し替え',
      'イベント名の修正',
    ],
  ],
  [
    'en',
    'Communities',
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
  'F30-AC42: Given the help in %s, When the section on communities is read, Then it covers making one, its links, admins, deleting, and what to ask the service for',
  async (lang, title, phrases) => {
    const section = await sectionText(lang, 'communities')
    expect(section.title).toBe(title)
    for (const phrase of phrases) expect(section.body).toContain(squash(phrase))
    if (lang === 'en') expect(section.body).not.toMatch(JAPANESE)
  },
)

test.each(['ja', 'en'] as const)(
  'F30-AC42: Given the page that makes a community in %s, When it is drawn, Then it links to the help’s section on communities',
  async (lang) => {
    const page = String(await newCommunityBody(emptyNewCommunityForm(''), lang))
    expect(page).toContain(`href="${helpSectionPath('communities')}"`)
    expect(helpSectionPath('communities')).toBe('/help#communities')
  },
)
