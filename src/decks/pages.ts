import { notificationsTitle } from '../notifications/pages'
import { manageLink } from '../reactions/pages'
import type { Context } from 'hono'
import { html } from 'hono/html'
import { pageShell, type PageWidth } from '../site/shell'
import { messages, type Lang } from '../site/i18n'
import { langOf } from '../site/lang'
import { SERVICE_NAME } from '../site/service'
import type { HtmlEscapedString } from 'hono/utils/html'
import type { HistoryEntry } from './history'
import { AVATAR_ORIGIN } from '../profile/github-profile'
import { reasonLabel, stateLabel } from './history'
import {
  deploymentActions,
  publicationPanel,
  type PanelView,
} from '../publication/panel'

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
    deleteAccountConfirm: (login: Html) =>
      html`確認のため、GitHub のユーザー名 ${login} を入力してください`,
    deleteAccountFailedTitle: '退会できませんでした',
    deleteAccountMismatch:
      '入力したユーザー名が一致しません。何も削除していません。',
    backToSettings: '設定に戻る',
    decksTitle: 'スライドの管理',
    settings: '設定',
    signedInAs: (login: string) => `${login} としてログイン中`,
    columns: {
      deck: 'スライド',
      repository: 'リポジトリ',
      branches: '許可ブランチ',
    },
    noDecks: 'まだスライドはありません。',
  },
  en: {
    signInTitle: 'Sign in',
    signIn: 'Sign in with your own GitHub account.',
    signInLink: 'Sign in with GitHub',
    logout: 'Sign out',
    deleteAccount: 'Delete account',
    deleteAccountNote:
      'Deletes all your slides and signs you out. Public URLs stop working at once, and the files and records of received versions are erased about 24 hours later. This cannot be undone.',
    deleteAccountConfirm: (login: Html) =>
      html`To confirm, type your GitHub username ${login}`,
    deleteAccountFailedTitle: 'Could not delete your account',
    deleteAccountMismatch:
      'The username you typed does not match. Nothing was deleted.',
    backToSettings: 'Back to settings',
    decksTitle: 'Your slides',
    settings: 'Settings',
    signedInAs: (login: string) => `Signed in as ${login}`,
    columns: {
      deck: 'Slides',
      repository: 'Repository',
      branches: 'Allowed branches',
    },
    noDecks: 'No slides yet.',
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

export const accountDeletion = (login: string, lang: Lang) => {
  const t = accountText[lang]
  return html`<h3>${t.deleteAccount}</h3>
    <p>${t.deleteAccountNote}</p>
    <form method="post" action="/account/delete">
      <label
        >${t.deleteAccountConfirm(html`<code>${login}</code>`)}
        <input class="text-input" name="confirm" autocomplete="off" required
      /></label>
      <button class="button-danger" type="submit">${t.deleteAccount}</button>
    </form>`
}

export const accountMismatchBody = (lang: Lang) =>
  html`<h1>${accountText[lang].deleteAccountFailedTitle}</h1>
    <p class="notice-danger">${accountText[lang].deleteAccountMismatch}</p>
    <p><a href="/settings">${accountText[lang].backToSettings}</a></p>`

export function deckListBody(
  login: string,
  decks: readonly {
    deck: string
    repository: string
    allowedRefs: readonly string[]
  }[],
  unread: number,
  lang: Lang,
): Html {
  const t = accountText[lang]
  const rows = decks.map(
    (deck) =>
      html`<tr>
        <td>
          <span class="cell-label">${t.columns.deck}</span
          ><a href="/slides/${deck.deck}">${deck.deck}</a>
        </td>
        <td>
          <span class="cell-label">${t.columns.repository}</span
          >${deck.repository}
        </td>
        <td>
          <span class="cell-label">${t.columns.branches}</span
          >${deck.allowedRefs.map((ref) => html`<code>${ref}</code> `)}
        </td>
      </tr>`,
  )
  return html`<h1>${t.decksTitle}</h1>
    <p>${t.signedInAs(login)}</p>
    <p><a href="/notifications">${notificationsTitle(lang, unread)}</a></p>
    <table class="data-table">
      <tr>
        <th>${t.columns.deck}</th>
        <th>${t.columns.repository}</th>
        <th>${t.columns.branches}</th>
      </tr>
      ${
        rows.length
          ? rows
          : html`<tr>
              <td colspan="3">${t.noDecks}</td>
            </tr>`
      }
    </table>
    <p><a href="/settings">${t.settings}</a></p>`
}

const deckText = messages({
  ja: {
    decks: 'スライド一覧',
    notFoundTitle: '見つかりません',
    notFound: 'スライドが見つかりません',
    historyTitle: (deck: string) => `${deck} の履歴`,
    missing: (count: number) => `未受領 ${count} 件`,
    more: (count: number) => `ほか ${count} 件`,
    deleteHeading: 'スライドを削除する',
    deleteNote:
      '公開中の URL と作者限定の閲覧はすぐに読めなくなり、repository との連携も外れます。受領したすべての版のファイルと記録は、24 時間ほど後に消えます。元には戻せません。',
    deleteConfirm: (deck: Html) =>
      html`確認のため、スライド名 ${deck} を入力してください`,
    delete: '削除する',
    deleteFailedTitle: '削除できませんでした',
    deleteMismatch: '入力したスライド名が一致しません。何も削除していません。',
    backToDeck: 'スライドに戻る',
    history: '受領履歴',
    historyNoteDelivery:
      '受領完了の版は、一般公開するまで作者だけが開けます。作者限定で開くと別の tab で表示し、この画面は残ります。',
    historyNote: '受領完了の版は、一般公開するまで作者だけのものです。',
    columns: {
      state: '状態',
      files: 'ファイル',
      started: '開始',
      publish: '公開',
    },
    noVersions: 'まだ受領した版はありません。',
    older: 'さらに古い版',
  },
  en: {
    decks: 'Your slides',
    notFoundTitle: 'Not found',
    notFound: 'Slides not found',
    historyTitle: (deck: string) => `${deck} history`,
    missing: (count: number) => `${count} not received`,
    more: (count: number) => `${count} more`,
    deleteHeading: 'Delete these slides',
    deleteNote:
      'Their public URL and author-only views stop working at once, and they are disconnected from the repository. The files and records of every received version are erased about 24 hours later. This cannot be undone.',
    deleteConfirm: (deck: Html) => html`To confirm, type the slide ID ${deck}`,
    delete: 'Delete',
    deleteFailedTitle: 'Could not delete',
    deleteMismatch:
      'The slide ID you typed does not match. Nothing was deleted.',
    backToDeck: 'Back to the slides',
    history: 'Upload history',
    historyNoteDelivery:
      'A received version is open only to you until you publish it. Opening it as the author shows it in another tab and keeps this page.',
    historyNote: 'A received version stays yours alone until you publish it.',
    columns: {
      state: 'State',
      files: 'Files',
      started: 'Started',
      publish: 'Publish',
    },
    noVersions: 'No versions received yet.',
    older: 'Older versions',
  },
})

/** Page titles of the deck pages, for renderPage. */
export const deckTitles = (lang: Lang) => deckText[lang]

export const notFoundBody = (lang: Lang) =>
  html`<h1>${deckText[lang].notFound}</h1>
    <p><a href="/slides">${deckText[lang].decks}</a></p>`

const date = (seconds: number | null) =>
  seconds === null ? '' : new Date(seconds * 1000).toISOString()

function filesCell(entry: HistoryEntry, lang: Lang) {
  const t = deckText[lang]
  const { files } = entry
  const missing = files.missing.length
    ? html`<details>
        <summary>
          ${t.missing(files.missing.length + files.missingNotShown)}
        </summary>
        <ul>
          ${files.missing.map((path) => html`<li><code>${path}</code></li>`)}
        </ul>
        ${files.missingNotShown ? html`<p>${t.more(files.missingNotShown)}</p>` : ''}
      </details>`
    : ''
  return html`${files.received} / ${files.total}${missing}`
}

const deletionSection = (deck: string, lang: Lang) => {
  const t = deckText[lang]
  return html`<h2>${t.deleteHeading}</h2>
    <p>${t.deleteNote}</p>
    <form method="post" action="/slides/${deck}/delete">
      <label
        >${t.deleteConfirm(html`<code>${deck}</code>`)}
        <input class="text-input" name="confirm" autocomplete="off" required
      /></label>
      <button class="button-danger" type="submit">${t.delete}</button>
    </form>`
}

export const deletionMismatchBody = (deck: string, lang: Lang) =>
  html`<h1>${deckText[lang].deleteFailedTitle}</h1>
    <p class="notice-danger">${deckText[lang].deleteMismatch}</p>
    <p><a href="/slides/${deck}">${deckText[lang].backToDeck}</a></p>`

export function historyBody(
  deck: string,
  entries: readonly HistoryEntry[],
  olderCursor: string | null,
  publication: PanelView,
  lang: Lang,
): Html {
  const t = deckText[lang]
  const rows = entries.map(
    (entry) =>
      html`<tr>
        <td>
          <span class="cell-label">commit / ref</span>
          <code>${entry.commit.slice(0, 12)}</code><br /><code
            >${entry.ref}</code
          >
        </td>
        <td>
          <span class="cell-label">${t.columns.state}</span>
          ${stateLabel(entry.state, lang)}
          ${
            entry.failureReason
              ? html`<div class="reason notice-danger">
                  ${reasonLabel(entry.failureReason, lang)}
                </div>`
              : ''
          }
        </td>
        <td>
          <span class="cell-label">${t.columns.files}</span
          >${filesCell(entry, lang)}
        </td>
        <td>
          <span class="cell-label">${t.columns.started}</span
          >${date(entry.createdAt)}
        </td>
        <td>
          <span class="cell-label">deployment</span
          ><code>${entry.deploymentId}</code>
        </td>
        <td>
          <span class="cell-label">${t.columns.publish}</span
          >${deploymentActions(deck, publication, entry, lang)}
        </td>
      </tr>`,
  )
  return html`<p><a href="/slides">${t.decks}</a></p>
    <h1>${deck}</h1>
    ${publicationPanel(deck, publication, lang)} ${manageLink(deck, lang)}
    <h2>${t.history}</h2>
    ${
      publication.delivery
        ? html`<p>${t.historyNoteDelivery}</p>`
        : html`<p>${t.historyNote}</p>`
    }
    <table class="data-table">
      <tr>
        <th>commit / ref</th>
        <th>${t.columns.state}</th>
        <th>${t.columns.files}</th>
        <th>${t.columns.started}</th>
        <th>deployment</th>
        <th>${t.columns.publish}</th>
      </tr>
      ${
        rows.length
          ? rows
          : html`<tr>
              <td colspan="6">${t.noVersions}</td>
            </tr>`
      }
    </table>
    ${
      olderCursor
        ? html`<p>
            <a href="/slides/${deck}?before=${encodeURIComponent(olderCursor)}"
              >${t.older}</a
            >
          </p>`
        : ''
    }
    ${deletionSection(deck, lang)}`
}
