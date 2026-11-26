import { messages, type Lang } from '../site/i18n'

/**
 * What a reader wants to do, in the order the help lists them (D-45). The
 * name is the URL's segment: `/help/<aim>`. `bot` is not one of them; that
 * path is the Luma feed bot's page.
 */
export const HELP_AIMS = [
  'start',
  'slides',
  'articles',
  'sharing',
  'community',
  'agent',
  'account',
  'safety',
] as const
export type HelpAim = (typeof HELP_AIMS)[number]

export const isHelpAim = (value: string): value is HelpAim =>
  (HELP_AIMS as readonly string[]).includes(value)

type AimText = Readonly<{ name: string; summary: string }>

const text = messages<Readonly<Record<HelpAim, AimText>>>({
  ja: {
    start: {
      name: 'はじめる',
      summary: 'ログインして、使い始めるまで。',
    },
    slides: {
      name: 'スライドを置く・直す',
      summary: 'ファイルを置き、公開し、差し替え、URL の名前を決める。',
    },
    articles: {
      name: '記事とリンクを添える',
      summary: 'スライドの下に、記事と関連リンクを載せる。',
    },
    sharing: {
      name: '読む・共有する',
      summary: 'ページを指して渡す。ブログに埋め込む。',
    },
    community: {
      name: 'つながる',
      summary:
        'フォロー、引用、イベント、コミュニティで、人とスライドがつながる。',
    },
    agent: {
      name: 'AI エージェント',
      summary: 'AI エージェントからスライドと記事の下書きを置く。',
    },
    account: {
      name: 'アカウントとデータ',
      summary: 'プロフィール、メールアドレス。',
    },
    safety: {
      name: '安全と規約',
      summary: '知らない人のスライドを開くとき、ブロック、規約。',
    },
  },
  en: {
    start: {
      name: 'Getting started',
      summary: 'Signing in and starting to use the service.',
    },
    slides: {
      name: 'Put up and fix slides',
      summary: 'Put files up, publish, replace, and choose the URL’s name.',
    },
    articles: {
      name: 'Add an article and links',
      summary: 'Put an article and related links under a slide.',
    },
    sharing: {
      name: 'Read and share',
      summary: 'Point at one page, and embed slides in a blog.',
    },
    community: {
      name: 'Connect',
      summary:
        'People and slides connect through following, citations, events and communities.',
    },
    agent: {
      name: 'AI agents',
      summary: 'Put up slides and write article drafts from an AI agent.',
    },
    account: {
      name: 'Account and data',
      summary: 'Your profile and your email address.',
    },
    safety: {
      name: 'Safety and terms',
      summary:
        'Opening slides from people you do not know, blocking, the terms.',
    },
  },
})

export const aimName = (aim: HelpAim, lang: Lang) => text[lang][aim].name
export const aimSummary = (aim: HelpAim, lang: Lang) => text[lang][aim].summary
