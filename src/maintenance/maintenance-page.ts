import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import { HELP_PATH } from '../site/help-page'
import { legalPath } from '../site/legal-pages'
import { messages, type Lang } from '../site/i18n'
import { pageShell } from '../site/shell'
import { formatJst, formatUtc, reasonSentence } from './maintenance-text'
import { formatUntil, type MaintenanceReason } from './switch'

type Html = HtmlEscapedString | Promise<HtmlEscapedString>

/** What the page says: the expected end if one is ahead, and the reason if given. */
export type MaintenanceView = Readonly<{
  until: number | null
  reason: MaintenanceReason | null
}>

const text = messages({
  ja: {
    title: 'メンテナンス中です',
    message: 'しばらくしてから、もう一度アクセスしてください。',
    expected: (time: Html, utc: string) =>
      html`${time}(日本時間。${utc})ごろに終わる見込みです。`,
    readable: '読めるページ',
    help: 'ヘルプ',
    terms: '利用規約',
    privacy: 'プライバシーポリシー',
    contact: 'お問い合わせ',
  },
  en: {
    title: 'Under maintenance',
    message: 'Please come back in a little while.',
    expected: (time: Html, utc: string) =>
      html`We expect to be back around ${time} (${utc}).`,
    readable: 'Pages you can still read',
    help: 'Help',
    terms: 'Terms of Service',
    privacy: 'Privacy Policy',
    contact: 'Contact',
  },
})

/** Links stay at least 44px tall to press (DESIGN.md). */
const style = html`<style>
  .maintenance-links {
    list-style: none;
    padding: 0;
    margin: 0 0 16px;
  }
  .maintenance-links a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
</style>`

/**
 * The page of a stopped service (02-PAGES 14), in this order: the title, the
 * expected end, the reason, and the pages that are still readable (F38-AC9,
 * AC10, AC11, AC12). It reads nothing but what it is given, so it opens
 * while D1 is being restored. `url` is the page asked for, which the language
 * switcher reopens.
 */
export const maintenancePage = (
  view: MaintenanceView,
  lang: Lang,
  url: URL,
) => {
  const t = text[lang]
  return pageShell({
    lang,
    title: t.title,
    url,
    width: 'narrow',
    style,
    body: html`<div class="color-block color-block-ecru error-block">
      <h1>${t.title}</h1>
      <p>${t.message}</p>
      ${
        view.until === null
          ? ''
          : html`<p>
              ${t.expected(
                html`<time datetime="${formatUntil(view.until)}"
                  >${formatJst(view.until, lang)}</time
                >`,
                formatUtc(view.until),
              )}
            </p>`
      }
      ${view.reason === null ? '' : html`<p>${reasonSentence(view.reason, lang)}</p>`}
      <h2>${t.readable}</h2>
      <ul class="maintenance-links">
        <li><a href="${HELP_PATH}">${t.help}</a></li>
        <li><a href="${legalPath('terms')}">${t.terms}</a></li>
        <li><a href="${legalPath('privacy')}">${t.privacy}</a></li>
        <li><a href="${legalPath('contact')}">${t.contact}</a></li>
      </ul>
    </div>`,
  })
}
