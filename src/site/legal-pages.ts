import { html } from 'hono/html'
import { legalTextPage } from '../legal/document-pages'
import {
  LEGAL_TEXT_KINDS,
  LEGAL_TEXT_PATHS,
  LEGAL_TEXTS,
  type LegalTextKind,
} from '../legal/documents'
import { messages, type Lang } from './i18n'
import { pageShell, PLAIN_PAGE_POLICY } from './shell'

/** Legal pages carry only service markup and the shared frame. */
export const LEGAL_PAGE_POLICY = PLAIN_PAGE_POLICY

/** Where inquiries are sent. Mail to it is forwarded to the operators (F17-AC24). */
export const CONTACT_ADDRESS = 'contact@slide.community'

export const legalKinds = [...LEGAL_TEXT_KINDS, 'contact'] as const
export type LegalKind = (typeof legalKinds)[number]

/** What the contact page will cover, until its text is decided (issue #65). */
const contactSections: readonly string[] = [
  'サービスについての質問',
  '不正な資料の通報',
  '個人情報の扱いについての請求',
]

// Placeholders only: the wording is decided by a person before launch.
const text = messages({
  ja: {
    titles: {
      contact: 'お問い合わせ',
    },
    draft: (title: string) => `${title}（仮）`,
    notice: 'このページは仮のものです。',
    notBinding:
      '正式な内容はまだ決めていません。ここに書いたことは、約束や合意として扱いません。',
    contactLead: 'お問い合わせは、次のメールアドレスへお送りください。',
    replaced: '正式な内容を決めたら、このページを差し替えます。',
    planned: '載せる予定の内容',
    top: 'トップページへ',
  },
  en: {
    titles: {
      contact: 'Contact',
    },
    draft: (title: string) => `${title} (draft)`,
    notice: 'This page is a placeholder.',
    notBinding:
      'The final text has not been decided yet. Nothing written here is a promise or an agreement.',
    contactLead: 'Please send inquiries to this email address.',
    replaced: 'This page will be replaced once the final text is decided.',
    planned: 'Planned contents (in Japanese only)',
    top: 'Go to the top page',
  },
})

export const legalPath = (kind: LegalKind): string =>
  kind === 'contact' ? '/contact' : LEGAL_TEXT_PATHS[kind]

const isTextKind = (kind: LegalKind): kind is LegalTextKind =>
  kind !== 'contact'

const contactPage = (lang: Lang, url: URL) => {
  const t = text[lang]
  const title = t.draft(t.titles.contact)
  return pageShell({
    lang,
    title,
    url,
    width: 'reading',
    style: html`<style>
      .address {
        font-family: var(--font-mono);
        user-select: all;
      }
    </style>`,
    body: html`<h1>${title}</h1>
      <p class="notice-warning" role="note">
        <strong>${t.notice}</strong>
        ${t.notBinding} ${t.replaced}
      </p>
      <p>${t.contactLead}</p>
      <p class="address">
        <a href="mailto:${CONTACT_ADDRESS}">${CONTACT_ADDRESS}</a>
      </p>
      <h2>${t.planned}</h2>
      <ul lang="ja">
        ${contactSections.map((section) => html`<li>${section}</li>`)}
      </ul>`,
  })
}

export const legalPage = (kind: LegalKind, lang: Lang, url: URL) =>
  isTextKind(kind)
    ? legalTextPage(LEGAL_TEXTS[kind], lang, url)
    : contactPage(lang, url)
