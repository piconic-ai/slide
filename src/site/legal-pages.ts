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

/** The pages of the legal texts, and the contact page, which has no text. */
export const legalKinds = [...LEGAL_TEXT_KINDS, 'contact'] as const
export type LegalKind = (typeof legalKinds)[number]

const text = messages({
  ja: {
    contact: 'お問い合わせ',
    contactLead: 'お問い合わせは、次のメールアドレスへお送りください。',
  },
  en: {
    contact: 'Contact',
    contactLead: 'Please send inquiries to this email address.',
  },
})

export const legalPath = (kind: LegalKind): string =>
  kind === 'contact' ? '/contact' : LEGAL_TEXT_PATHS[kind]

const isTextKind = (kind: LegalKind): kind is LegalTextKind =>
  kind !== 'contact'

const contactPage = (lang: Lang, url: URL) => {
  const t = text[lang]
  return pageShell({
    lang,
    title: t.contact,
    url,
    width: 'reading',
    style: html`<style>
      .address {
        font-family: var(--font-mono);
        user-select: all;
      }
    </style>`,
    body: html`<h1>${t.contact}</h1>
      <p>${t.contactLead}</p>
      <p class="address">
        <a href="mailto:${CONTACT_ADDRESS}">${CONTACT_ADDRESS}</a>
      </p>`,
  })
}

export const legalPage = (kind: LegalKind, lang: Lang, url: URL) =>
  isTextKind(kind)
    ? legalTextPage(LEGAL_TEXTS[kind], lang, url)
    : contactPage(lang, url)
