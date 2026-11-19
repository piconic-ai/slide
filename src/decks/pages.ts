import type { Context } from 'hono'
import { html } from 'hono/html'
import { pageShell, type PageWidth } from '../site/shell'
import { messages, type Lang } from '../site/i18n'
import { langOf } from '../site/lang'
import { SERVICE_NAME } from '../site/service'
import type { HtmlEscapedString } from 'hono/utils/html'
import { AVATAR_ORIGIN } from '../profile/github-profile'

type Html = HtmlEscapedString | Promise<HtmlEscapedString>

// Owner pages render only service markup and the service's own scripts;
// uploaded HTML is never served here.
// The header asks the service who is signed in, hence connect-src.
// The one image a page shows is an author's picture, served by GitHub: on
// their profile, and as the header's icon when they are signed in.
const PAGE_POLICY = `default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self' https://github.com; base-uri 'none'; frame-ancestors 'none'; img-src ${AVATAR_ORIGIN}`

/**
 * The static top page fetches its recent decks from the same origin and
 * shows each one's cover image: a file of the deck, or the cover the service
 * takes. The decks are not known when the page is answered, so any
 * deployment origin may give an image. No deck is framed. The header's icon
 * is the signed-in author's picture, as on every page.
 */
export const homePagePolicy = (contentBase: URL | null) =>
  contentBase
    ? `${PAGE_POLICY} 'self' ${contentBase.protocol}//*.${contentBase.host}`
    : PAGE_POLICY

export function renderPage<E extends { Bindings: Env }>(
  c: Context<E>,
  title: string,
  body: Html,
  status: 200 | 400 | 401 | 404 = 200,
  /** Profile covers need the same img hosts as the top page. */
  policy: string = PAGE_POLICY,
  width: PageWidth = 'wide',
) {
  const lang = langOf(c)
  c.header('Content-Security-Policy', policy)
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  return c.html(
    pageShell({ lang, title, body, width, url: new URL(c.req.url) }),
    status,
  )
}

const accountText = messages({
  ja: {
    signInTitle: 'ログイン',
    signIn: '本人の GitHub アカウントでログインしてください。',
    signInLink: 'GitHub でログイン',
    logout: 'ログアウト',
    deleteAccount: '退会する',
    deleteAccountNote:
      'すべてのスライドを削除し、ログインを終えます。公開中の URL はすぐに読めなくなり、受領した版のファイルと記録は 24 時間ほど後に消えます。元には戻せません。',
    deleteAccountConfirm: '確認のため、GitHub のユーザー名を入力してください',
    deleteAccountLogin: (login: Html) =>
      html`あなたの GitHub のユーザー名は ${login} です。`,
    deleteAccountFailedTitle: '退会できませんでした',
    deleteAccountMismatch:
      '入力したユーザー名が一致しません。何も削除していません。',
    backToSettings: '設定に戻る',
  },
  en: {
    signInTitle: 'Sign in',
    signIn: 'Sign in with your own GitHub account.',
    signInLink: 'Sign in with GitHub',
    logout: 'Sign out',
    deleteAccount: 'Delete account',
    deleteAccountNote:
      'Deletes all your slides and signs you out. Public URLs stop working at once, and the files and records of received versions are erased about 24 hours later. This cannot be undone.',
    deleteAccountConfirm: 'To confirm, type your GitHub username',
    deleteAccountLogin: (login: Html) =>
      html`Your GitHub username is ${login}.`,
    deleteAccountFailedTitle: 'Could not delete your account',
    deleteAccountMismatch:
      'The username you typed does not match. Nothing was deleted.',
    backToSettings: 'Back to settings',
  },
})

/** Page titles of the account pages, for renderPage. */
export const accountTitles = (lang: Lang) => accountText[lang]

export const signInPrompt = (lang: Lang) =>
  html`<h1>${SERVICE_NAME}</h1>
    <p>${accountText[lang].signIn}</p>
    <p>
      <a class="button-primary" href="/auth/github"
        >${accountText[lang].signInLink}</a
      >
    </p>`

export const logoutForm = (lang: Lang) =>
  html`<form method="post" action="/auth/logout">
    <button class="button-secondary">${accountText[lang].logout}</button>
  </form>`

/**
 * Leaving the service, laid out top to bottom: what happens, a labelled
 * field to type the username into, then the button. The caller gives the
 * heading.
 */
export const accountDeletion = (login: string, lang: Lang) => {
  const t = accountText[lang]
  return html`<p>${t.deleteAccountNote}</p>
    <form method="post" action="/account/delete">
      <label for="leave-confirm">${t.deleteAccountConfirm}</label>
      <input
        class="text-input"
        id="leave-confirm"
        name="confirm"
        autocomplete="off"
        required
        aria-describedby="leave-confirm-note"
      />
      <p class="field-note" id="leave-confirm-note">
        ${t.deleteAccountLogin(html`<code>${login}</code>`)}
      </p>
      <button class="button-danger" type="submit">${t.deleteAccount}</button>
    </form>`
}

export const accountMismatchBody = (lang: Lang) =>
  html`<h1>${accountText[lang].deleteAccountFailedTitle}</h1>
    <p class="notice-danger">${accountText[lang].deleteAccountMismatch}</p>
    <p><a href="/settings">${accountText[lang].backToSettings}</a></p>`

const deckText = messages({
  ja: {
    decks: 'スライド一覧',
    notFoundTitle: '見つかりません',
    notFound: 'スライドが見つかりません',
    deleteFailedTitle: '削除できませんでした',
    deleteMismatch: '入力したスライド名が一致しません。何も削除していません。',
    backToDeck: 'スライドに戻る',
  },
  en: {
    decks: 'Your slides',
    notFoundTitle: 'Not found',
    notFound: 'Slides not found',
    deleteFailedTitle: 'Could not delete',
    deleteMismatch:
      'The slide ID you typed does not match. Nothing was deleted.',
    backToDeck: 'Back to the slides',
  },
})

/** Page titles of the deck pages, for renderPage. */
export const deckTitles = (lang: Lang) => deckText[lang]

export const notFoundBody = (lang: Lang) =>
  html`<h1>${deckText[lang].notFound}</h1>
    <p><a href="/slides">${deckText[lang].decks}</a></p>`

export const deletionMismatchBody = (deck: string, lang: Lang) =>
  html`<h1>${deckText[lang].deleteFailedTitle}</h1>
    <p class="notice-danger">${deckText[lang].deleteMismatch}</p>
    <p><a href="/slides/${deck}">${deckText[lang].backToDeck}</a></p>`
