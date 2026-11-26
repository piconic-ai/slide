import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import { LANG_NAMES, LANGS, langHref, messages, type Lang } from './i18n'

type Html = HtmlEscapedString | Promise<HtmlEscapedString>

const text = messages({
  ja: {
    terms: '規約',
    privacy: 'プライバシー',
    contact: 'お問い合わせ',
    help: 'ヘルプ',
    language: '表示言語',
    repository: 'GitHub のリポジトリ',
    operatedBy: (operator: Html) => html`運営者: ${operator}`,
  },
  en: {
    terms: 'Terms',
    privacy: 'Privacy',
    contact: 'Contact',
    help: 'Help',
    language: 'Language',
    repository: 'GitHub repository',
    operatedBy: (operator: Html) => html`Operated by ${operator}`,
  },
})

/** Who runs the service, and where to reach them (D-24). */
export const OPERATOR_NAME = 'kobaken'
export const OPERATOR_URL = 'https://x.com/kfly8'

/** Where the source of the service lives. The footer links here, once. */
export const REPOSITORY_URL = 'https://github.com/piconic-ai/slide'

/**
 * The GitHub mark, inline so that no image or stylesheet is fetched and the CSP stays as
 * it is. Path from Octicons `mark-github` (16px), MIT License, Copyright (c) 2026 GitHub
 * Inc. The full notice is in THIRD_PARTY_NOTICES.md; upstream:
 * https://github.com/primer/octicons/blob/main/LICENSE
 */
const GITHUB_MARK_PATH =
  'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z'

/**
 * Links to the help, the legal pages and the language switcher, shown at the bottom of
 * every service page. `url` is the page itself, which the switcher reopens
 * in the other language.
 */
export function siteFooter(lang: Lang, url: URL) {
  const t = text[lang]
  return html`<footer class="site-footer">
    <nav>
      <a href="/help">${t.help}</a>
      <a href="/terms">${t.terms}</a>
      <a href="/privacy">${t.privacy}</a>
      <a href="/contact">${t.contact}</a>
      <span class="operator"
        >${t.operatedBy(
          html`<a href="${OPERATOR_URL}" rel="noopener noreferrer"
            >${OPERATOR_NAME}</a
          >`,
        )}</span
      >
      <a
        class="github-link"
        href="${REPOSITORY_URL}"
        rel="noopener noreferrer"
        aria-label="${t.repository}"
        ><svg
          viewBox="0 0 16 16"
          width="20"
          height="20"
          fill="currentColor"
          aria-hidden="true"
          focusable="false"
        >
          <!-- Octicons mark-github, Copyright (c) GitHub, Inc., MIT License.
            https://github.com/primer/octicons/blob/main/LICENSE -->
          <path d="${GITHUB_MARK_PATH}" />
        </svg>
      </a>
    </nav>
    <p role="group" aria-label="${t.language}">${langChoices(lang, url)}</p>
  </footer>`
}

/** 日本語 / English, the current one as text and the other as a link. */
export function langChoices(lang: Lang, url: URL) {
  const choices = LANGS.map((choice) =>
    choice === lang
      ? html`<strong lang="${choice}" aria-current="true"
          >${LANG_NAMES[choice]}</strong
        >`
      : html`<a
          href="${langHref(url, choice)}"
          lang="${choice}"
          hreflang="${choice}"
          >${LANG_NAMES[choice]}</a
        >`,
  )
  return choices.flatMap((choice, i) => (i ? [' / ', choice] : [choice]))
}
