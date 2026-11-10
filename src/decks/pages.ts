import type { Context } from 'hono'
import { html } from 'hono/html'
import { siteFooter } from '../site/footer'
import { messages, type Lang } from '../site/i18n'
import { langOf } from '../site/lang'
import { SERVICE_NAME } from '../site/service'
import type { HtmlEscapedString } from 'hono/utils/html'
import type { HistoryEntry } from './history'
import { reasonLabel, stateLabel } from './history'
import {
  deploymentActions,
  publicationPanel,
  type PanelView,
} from '../publication/panel'

type Html = HtmlEscapedString | Promise<HtmlEscapedString>

// Owner pages render only service markup and the service's own scripts;
// uploaded HTML is never served here.
const PAGE_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; form-action 'self' https://github.com; base-uri 'none'; frame-ancestors 'none'"

/** The static top page fetches its recent decks from the same origin. */
export const HOME_PAGE_POLICY = `${PAGE_POLICY}; connect-src 'self'`

export const pageStyle = html`<style>
  body {
    font: 16px system-ui;
    max-width: 960px;
    margin: 4vh auto;
    padding: 0 16px;
    color: #152439;
    background: #f4f6fa;
    /* Handles and deck IDs are long unbroken words on narrow screens. */
    overflow-wrap: anywhere;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    background: white;
  }
  th,
  td {
    text-align: left;
    padding: 8px;
    border-bottom: 1px solid #d6dde8;
    vertical-align: top;
  }
  code {
    overflow-wrap: anywhere;
  }
  pre {
    background: white;
    border: 1px solid #d6dde8;
    padding: 12px;
    overflow-x: auto;
  }
  pre code {
    overflow-wrap: normal;
  }
  form {
    margin: 16px 0;
  }
  input,
  button {
    font: inherit;
    padding: 6px 10px;
  }
  .reason {
    color: #8a1c1c;
  }
  .site-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 24px;
  }
  .site-header .brand {
    font-weight: 700;
    font-size: 20px;
    color: inherit;
    text-decoration: none;
    margin-right: auto;
  }
  .hero {
    padding: 40px 0 24px;
  }
  .hero h1 {
    font-size: clamp(28px, 6vw, 44px);
    line-height: 1.25;
    margin: 0 0 16px;
  }
  .hero p {
    line-height: 1.7;
    max-width: 40em;
  }
  .cta {
    display: inline-block;
    padding: 10px 20px;
    border-radius: 8px;
    background: #153b70;
    color: white;
    text-decoration: none;
    font-weight: 600;
  }
  .cards {
    list-style: none;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 16px;
  }
  .card {
    background: white;
    border: 1px solid #d6dde8;
    border-radius: 10px;
    padding: 16px;
  }
  .card-title {
    font-weight: 600;
    font-size: 17px;
    color: inherit;
    overflow-wrap: anywhere;
  }
  .profile h1,
  .card-meta {
    overflow-wrap: anywhere;
  }
  .card-meta,
  .empty {
    color: #4f5f78;
    font-size: 14px;
    margin: 8px 0 0;
  }
</style>`

const headerText = messages({
  ja: { decks: 'デッキ管理' },
  en: { decks: 'Your decks' },
})

export const siteHeader = (lang: Lang) =>
  html`<header class="site-header">
    <a class="brand" href="/">${SERVICE_NAME}</a>
    <a href="/decks">${headerText[lang].decks}</a>
  </header>`

export function renderPage<E extends { Bindings: Env }>(
  c: Context<E>,
  title: string,
  body: Html,
  status: 200 | 400 | 401 | 404 = 200,
) {
  const lang = langOf(c)
  c.header('Content-Security-Policy', PAGE_POLICY)
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  return c.html(
    html`<!doctype html>
      <html lang="${lang}">
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width" />
        <title>${title} - ${SERVICE_NAME}</title>
        ${pageStyle}
        <script src="/share.js" defer></script>
        <body>
          ${siteHeader(lang)} ${body} ${siteFooter(lang, new URL(c.req.url))}
        </body>
      </html>`,
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
      'すべてのデッキを削除し、ログインを終えます。公開中の URL はすぐに読めなくなり、受領した版のファイルと記録は 24 時間ほど後に消えます。元には戻せません。',
    deleteAccountConfirm: (login: Html) =>
      html`確認のため、GitHub のユーザー名 ${login} を入力してください`,
    deleteAccountFailedTitle: '退会できませんでした',
    deleteAccountMismatch:
      '入力したユーザー名が一致しません。何も削除していません。',
    backToDecks: 'デッキ一覧に戻る',
    decksTitle: 'デッキ',
    signedInAs: (login: string) => `${login} としてログイン中`,
    connect: 'リポジトリを連携する',
    columns: {
      deck: 'デッキ',
      repository: 'リポジトリ',
      branches: '許可ブランチ',
    },
    noDecks: 'まだデッキはありません。',
    decks: 'デッキ一覧',
    deckListLink: 'デッキ一覧',
    buildComment: `必要ならここでスライドをビルドする。${SERVICE_NAME} はファイルを送るだけ`,
    step1: '1. デッキとリポジトリを登録する',
    step1Note:
      '管理権限のあるリポジトリに GitHub App をインストールしてから連携します。送信を許可するブランチは空白かカンマで区切ります。',
    deckId: 'デッキ ID',
    repository: 'リポジトリ（owner/name）',
    branches: 'ブランチ',
    confirmOnGitHub: 'GitHub で確認して連携する',
    step2: '2. GitHub Actions から送る',
    step2Note: (code: (text: string) => Html) =>
      html`連携したリポジトリに ${code('.github/workflows/slide.yml')}
      を置きます。${code('directory')} には ${code('index.html')}
      を含むビルド済みの directory、${code('deck')} には 1. で登録したデッキ ID
      を書きます。${SERVICE_NAME} はビルドせず、ファイルを送るだけです。`,
    step3: '3. 確かめて公開する',
    step3Note: (decks: Html, share: Html | null) =>
      html`workflow が終わったら、${decks}
      からデッキを開きます。受領した版は下書きで、作者だけが開けます。
      受領履歴から版を一般公開すると、${share ? html`${share} で` : '共有 URL から'}誰でも読めるようになります。`,
    deckIdPlaceholder: 'デッキ ID',
    repositoryMode: (code: Html) =>
      html`デッキの管理画面で公開方法を「リポジトリ設定に従う」に切り替えると、workflow
      の ${code} で受領と同時に公開できます。`,
  },
  en: {
    signInTitle: 'Sign in',
    signIn: 'Sign in with your own GitHub account.',
    signInLink: 'Sign in with GitHub',
    logout: 'Sign out',
    deleteAccount: 'Delete account',
    deleteAccountNote:
      'Deletes all your decks and signs you out. Public URLs stop working at once, and the files and records of received versions are erased about 24 hours later. This cannot be undone.',
    deleteAccountConfirm: (login: Html) =>
      html`To confirm, type your GitHub username ${login}`,
    deleteAccountFailedTitle: 'Could not delete your account',
    deleteAccountMismatch:
      'The username you typed does not match. Nothing was deleted.',
    backToDecks: 'Back to your decks',
    decksTitle: 'Your decks',
    signedInAs: (login: string) => `Signed in as ${login}`,
    connect: 'Connect a repository',
    columns: {
      deck: 'Deck',
      repository: 'Repository',
      branches: 'Allowed branches',
    },
    noDecks: 'No decks yet.',
    decks: 'Your decks',
    deckListLink: 'your deck list',
    buildComment: `Build your slides here if needed. ${SERVICE_NAME} only sends the files`,
    step1: '1. Register a deck and its repository',
    step1Note:
      'Install the GitHub App on a repository you administer, then connect it. Separate the branches allowed to upload with spaces or commas.',
    deckId: 'Deck ID',
    repository: 'Repository (owner/name)',
    branches: 'Branches',
    confirmOnGitHub: 'Confirm on GitHub and connect',
    step2: '2. Upload from GitHub Actions',
    step2Note: (code: (text: string) => Html) =>
      html`Add ${code('.github/workflows/slide.yml')} to the connected
      repository. Set ${code('directory')} to the built directory that holds
      ${code('index.html')}, and ${code('deck')} to the deck ID from step 1.
      ${SERVICE_NAME} does not build anything; it only sends the files.`,
    step3: '3. Check it, then publish',
    step3Note: (decks: Html, share: Html | null) =>
      html`When the workflow finishes, open the deck from ${decks}. A received
      version is a draft that only you can open. Publish a version from the
      upload history, and anyone can read it
      ${share ? html`at ${share}` : 'from its share link'}.`,
    deckIdPlaceholder: 'deck-id',
    repositoryMode: (code: Html) =>
      html`Switch the deck's publishing mode to “follow the repository”, and
      ${code} in the workflow publishes each version as soon as it is received.`,
  },
})

/** Page titles of the account pages, for renderPage. */
export const accountTitles = (lang: Lang) => accountText[lang]

export const signInPrompt = (lang: Lang) =>
  html`<h1>${SERVICE_NAME}</h1>
    <p>${accountText[lang].signIn}</p>
    <p><a href="/auth/github">${accountText[lang].signInLink}</a></p>`

const logoutForm = (lang: Lang) =>
  html`<form method="post" action="/auth/logout">
    <button>${accountText[lang].logout}</button>
  </form>`

const accountDeletion = (login: string, lang: Lang) => {
  const t = accountText[lang]
  return html`<h2>${t.deleteAccount}</h2>
    <p>${t.deleteAccountNote}</p>
    <form method="post" action="/account/delete">
      <label
        >${t.deleteAccountConfirm(html`<code>${login}</code>`)}
        <input name="confirm" autocomplete="off" required
      /></label>
      <button type="submit">${t.deleteAccount}</button>
    </form>`
}

export const accountMismatchBody = (lang: Lang) =>
  html`<h1>${accountText[lang].deleteAccountFailedTitle}</h1>
    <p>${accountText[lang].deleteAccountMismatch}</p>
    <p><a href="/decks">${accountText[lang].backToDecks}</a></p>`

export function deckListBody(
  login: string,
  decks: readonly {
    deck: string
    repository: string
    allowedRefs: readonly string[]
  }[],
  lang: Lang,
): Html {
  const t = accountText[lang]
  const rows = decks.map(
    (deck) =>
      html`<tr>
        <td><a href="/decks/${deck.deck}">${deck.deck}</a></td>
        <td>${deck.repository}</td>
        <td>${deck.allowedRefs.map((ref) => html`<code>${ref}</code> `)}</td>
      </tr>`,
  )
  return html`<h1>${t.decksTitle}</h1>
    <p>${t.signedInAs(login)}</p>
    ${logoutForm(lang)}
    <p><a class="cta" href="/decks/new">${t.connect}</a></p>
    <table>
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
    ${accountDeletion(login, lang)}`
}

// The action is referenced by commit until its distribution name is decided.
export const ACTION_REF =
  'piconic-ai/slide@7e70919399a8ac4c624ce9d6aca2e1b2dbd50dc3'

const workflowExample = (lang: Lang) => `name: Upload slides
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
jobs:
  upload:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v7.0.1
      - uses: actions/setup-node@v7.1.0
        with:
          node-version: 24
      # ${accountText[lang].buildComment}
      - uses: ${ACTION_REF}
        with:
          directory: dist
          deck: my-talk`

const code = (text: string) => html`<code>${text}</code>`

export const connectBody = (
  login: string,
  handle: string | null,
  lang: Lang,
): Html => {
  const t = accountText[lang]
  return html`<p><a href="/decks">${t.decks}</a></p>
    <h1>${t.connect}</h1>
    <p>${t.signedInAs(login)}</p>
    <h2>${t.step1}</h2>
    <p>${t.step1Note}</p>
    <form method="post" action="/decks/connect">
      <p>
        <label
          >${t.deckId}
          <input
            name="deck"
            required
            pattern="[a-z0-9](?:[a-z0-9\\-]{0,62}[a-z0-9])?"
        /></label>
      </p>
      <p>
        <label>${t.repository} <input name="repository" required /></label>
      </p>
      <p>
        <label
          >${t.branches} <input name="branches" value="main" required
        /></label>
      </p>
      <button>${t.confirmOnGitHub}</button>
    </form>
    <h2>${t.step2}</h2>
    <p>${t.step2Note(code)}</p>
    <pre><code>${workflowExample(lang)}</code></pre>
    <h2>${t.step3}</h2>
    <p>
      ${t.step3Note(
        html`<a href="/decks">${t.deckListLink}</a>`,
        handle ? code(`/@${handle}/${t.deckIdPlaceholder}`) : null,
      )}
    </p>
    <p>${t.repositoryMode(code('published: true'))}</p>`
}

const deckText = messages({
  ja: {
    decks: 'デッキ一覧',
    notFoundTitle: '見つかりません',
    notFound: 'デッキが見つかりません',
    historyTitle: (deck: string) => `${deck} の履歴`,
    missing: (count: number) => `未受領 ${count} 件`,
    more: (count: number) => `ほか ${count} 件`,
    deleteHeading: 'デッキを削除する',
    deleteNote:
      '公開中の URL と作者限定の閲覧はすぐに読めなくなり、repository との連携も外れます。受領したすべての版のファイルと記録は、24 時間ほど後に消えます。元には戻せません。',
    deleteConfirm: (deck: Html) =>
      html`確認のため、デッキ名 ${deck} を入力してください`,
    delete: '削除する',
    deleteFailedTitle: '削除できませんでした',
    deleteMismatch: '入力したデッキ名が一致しません。何も削除していません。',
    backToDeck: 'デッキに戻る',
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
    decks: 'Your decks',
    notFoundTitle: 'Not found',
    notFound: 'Deck not found',
    historyTitle: (deck: string) => `${deck} history`,
    missing: (count: number) => `${count} not received`,
    more: (count: number) => `${count} more`,
    deleteHeading: 'Delete this deck',
    deleteNote:
      'Its public URL and author-only views stop working at once, and it is disconnected from the repository. The files and records of every received version are erased about 24 hours later. This cannot be undone.',
    deleteConfirm: (deck: Html) => html`To confirm, type the deck name ${deck}`,
    delete: 'Delete',
    deleteFailedTitle: 'Could not delete',
    deleteMismatch:
      'The deck name you typed does not match. Nothing was deleted.',
    backToDeck: 'Back to the deck',
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
    <p><a href="/decks">${deckText[lang].decks}</a></p>`

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
    <form method="post" action="/decks/${deck}/delete">
      <label
        >${t.deleteConfirm(html`<code>${deck}</code>`)}
        <input name="confirm" autocomplete="off" required
      /></label>
      <button type="submit">${t.delete}</button>
    </form>`
}

export const deletionMismatchBody = (deck: string, lang: Lang) =>
  html`<h1>${deckText[lang].deleteFailedTitle}</h1>
    <p>${deckText[lang].deleteMismatch}</p>
    <p><a href="/decks/${deck}">${deckText[lang].backToDeck}</a></p>`

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
          <code>${entry.commit.slice(0, 12)}</code><br /><code
            >${entry.ref}</code
          >
        </td>
        <td>
          ${stateLabel(entry.state, lang)}
          ${
            entry.failureReason
              ? html`<div class="reason">
                  ${reasonLabel(entry.failureReason, lang)}
                </div>`
              : ''
          }
        </td>
        <td>${filesCell(entry, lang)}</td>
        <td>${date(entry.createdAt)}</td>
        <td><code>${entry.deploymentId}</code></td>
        <td>${deploymentActions(deck, publication, entry, lang)}</td>
      </tr>`,
  )
  return html`<p><a href="/decks">${t.decks}</a></p>
    <h1>${deck}</h1>
    ${publicationPanel(deck, publication, lang)}
    <h2>${t.history}</h2>
    ${
      publication.delivery
        ? html`<p>${t.historyNoteDelivery}</p>`
        : html`<p>${t.historyNote}</p>`
    }
    <table>
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
            <a href="/decks/${deck}?before=${encodeURIComponent(olderCursor)}"
              >${t.older}</a
            >
          </p>`
        : ''
    }
    ${deletionSection(deck, lang)}`
}
