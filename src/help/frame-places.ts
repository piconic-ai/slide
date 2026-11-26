import type { Lang } from '../site/i18n'
import type { HelpAim } from './aims'
import { helpArticlePath } from './paths'

/**
 * Where the service sends a reader to an article of the help from a screen
 * that is easy to lose one's way on (D-52): the place, the article it leads
 * to, and the words of the link in each language. A place holds one link
 * only (F36-AC41). The table is the one list of them, so a test reads every
 * link and a change of an article's name is found here.
 */
export const FRAME_HELP = {
  'settings-profile': {
    aim: 'account',
    slug: 'edit-profile',
    ja: 'プロフィールの書き方(ヘルプ)',
    en: 'How to write your profile (help)',
  },
  'settings-account': {
    aim: 'account',
    slug: 'change-email',
    ja: 'メールアドレスの変え方(ヘルプ)',
    en: 'How to change your email address (help)',
  },
  'settings-agents': {
    aim: 'agent',
    slug: 'connect',
    ja: 'AI エージェントのつなぎ方(ヘルプ)',
    en: 'How to connect an AI agent (help)',
  },
  'community-manage': {
    aim: 'community',
    slug: 'community-admins',
    ja: 'コミュニティの管理についてくわしく(ヘルプ)',
    en: 'More about running a community (help)',
  },
  'settings-blocks': {
    aim: 'safety',
    slug: 'block-vs-mute',
    ja: 'ブロックとミュートの違い(ヘルプ)',
    en: 'Blocking and muting compared (help)',
  },
  'settings-mutes': {
    aim: 'safety',
    slug: 'block-vs-mute',
    ja: 'ブロックとミュートの違い(ヘルプ)',
    en: 'Blocking and muting compared (help)',
  },
  'settings-leave': {
    aim: 'account',
    slug: 'before-leaving',
    ja: '退会する前にデータを残す方法(ヘルプ)',
    en: 'How to save your data before you leave (help)',
  },
  'deck-download': {
    aim: 'account',
    slug: 'export-slide',
    ja: 'zip の受け取り方(ヘルプ)',
    en: 'How to take the zip (help)',
  },
  'deck-replace': {
    aim: 'slides',
    slug: 'replace',
    ja: '差し替え方(ヘルプ)',
    en: 'How to replace slides (help)',
  },
  'deck-hidden': {
    aim: 'safety',
    slug: 'hidden-slide',
    ja: '非表示になったときは(ヘルプ)',
    en: 'What to do when slides are hidden (help)',
  },
  'community-edit': {
    aim: 'community',
    slug: 'community-admins',
    ja: 'コミュニティの管理についてくわしく(ヘルプ)',
    en: 'More about running a community (help)',
  },
  'agent-consent': {
    aim: 'agent',
    slug: 'capabilities',
    ja: 'AI エージェントにできること、できないこと(ヘルプ)',
    en: 'What an AI agent can and cannot do (help)',
  },
  'export-refused': {
    aim: 'account',
    slug: 'export-slide',
    ja: '受け取れないときは(ヘルプ)',
    en: 'When you cannot take it (help)',
  },
  suspended: {
    aim: 'safety',
    slug: 'appeal',
    ja: '利用の停止に異議を申し立てる(ヘルプ)',
    en: 'How to object to a suspension (help)',
  },
  'drop-limit': {
    aim: 'slides',
    slug: 'limits',
    ja: '上限についてくわしく(ヘルプ)',
    en: 'More about the limits (help)',
  },
  'drop-files': {
    aim: 'slides',
    slug: 'accepted-files',
    ja: '置けるファイルについてくわしく(ヘルプ)',
    en: 'More about the files you can put up (help)',
  },
  'drop-sign-in': {
    aim: 'start',
    slug: 'sign-in',
    ja: 'ログインについてくわしく(ヘルプ)',
    en: 'More about signing in (help)',
  },
  'sign-in-refused': {
    aim: 'start',
    slug: 'code-not-arrived',
    ja: 'コードが届かないときは(ヘルプ)',
    en: 'When the code does not arrive (help)',
  },
  'sign-up-refused': {
    aim: 'start',
    slug: 'sign-up',
    ja: '登録についてくわしく(ヘルプ)',
    en: 'More about signing up (help)',
  },
} as const satisfies Readonly<
  Record<
    string,
    Readonly<{ aim: HelpAim; slug: string } & Record<Lang, string>>
  >
>

export type FramePlace = keyof typeof FRAME_HELP

/** Where a place's link leads, and what it says in a language. */
export const frameHelpTarget = (place: FramePlace, lang: Lang) => {
  const entry = FRAME_HELP[place]
  return { href: helpArticlePath(entry.aim, entry.slug), label: entry[lang] }
}
