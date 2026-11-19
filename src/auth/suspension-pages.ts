import { html } from 'hono/html'
import { accountDeletion, logoutForm } from '../decks/pages'
import type { Suspension } from '../publication/suspension'
import { messages, type Lang } from '../site/i18n'
import { CONTACT_ADDRESS } from '../site/legal-pages'
import { pageShell, SHELL_SOURCES } from '../site/shell'

export const SUSPENSION_PAGE_POLICY = `default-src 'none'; ${SHELL_SOURCES}; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`

const text = messages({
  ja: {
    title: 'アカウントは停止中です',
    reason: '停止の理由',
    time: '停止した日時',
    contact: 'お問い合わせ',
  },
  en: {
    title: 'Your account is suspended',
    reason: 'Reason for suspension',
    time: 'Suspended at',
    contact: 'Contact us',
  },
})

/** Only the owner's notice is shown; the operator's identity is never rendered. */
export function suspensionPage(
  login: string,
  suspension: Pick<Suspension, 'reason' | 'suspendedAt'>,
  lang: Lang,
  url: URL,
) {
  const t = text[lang]
  const date = new Date(suspension.suspendedAt * 1000)
  const time = new Intl.DateTimeFormat(lang === 'ja' ? 'ja-JP' : 'en-US', {
    timeZone: 'Asia/Tokyo',
    dateStyle: 'medium',
    timeStyle: 'long',
  }).format(date)
  return pageShell({
    lang,
    title: t.title,
    url,
    width: 'narrow',
    body: html`<h1>${t.title}</h1>
      <h2>${t.reason}</h2>
      <p class="notice-danger preserve-lines">${suspension.reason}</p>
      <p>${t.time}: <time datetime="${date.toISOString()}">${time}</time></p>
      <p><a href="/contact">${t.contact}</a>: ${CONTACT_ADDRESS}</p>
      ${accountDeletion(login, lang)} ${logoutForm(lang)}`,
  })
}
