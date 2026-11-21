import { html } from 'hono/html'
import { LANG_NAMES, LANGS, langHref, messages, type Lang } from './i18n'

const text = messages({
  ja: {
    terms: '規約',
    privacy: 'プライバシー',
    contact: 'お問い合わせ',
    help: 'ヘルプ',
    language: '表示言語',
  },
  en: {
    terms: 'Terms',
    privacy: 'Privacy',
    contact: 'Contact',
    help: 'Help',
    language: 'Language',
  },
})

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
