import type { Context } from 'hono'
import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import type { HistoryEntry } from './history'
import { reasonLabel, stateLabel } from './history'
import {
  deploymentActions,
  publicationPanel,
  type ResultMessage,
} from '../publication/panel'
import type { DeckPublication } from '../publication/state'

type Html = HtmlEscapedString | Promise<HtmlEscapedString>

// Owner pages render only service markup; uploaded HTML is never served here.
const PAGE_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://github.com; base-uri 'none'; frame-ancestors 'none'"

const style = html`<style>
  body {
    font: 16px system-ui;
    max-width: 960px;
    margin: 4vh auto;
    padding: 0 16px;
    color: #152439;
    background: #f4f6fa;
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
</style>`

export function renderPage<E extends { Bindings: Env }>(
  c: Context<E>,
  title: string,
  body: Html,
  status: 200 | 401 | 404 = 200,
) {
  c.header('Content-Security-Policy', PAGE_POLICY)
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  return c.html(
    html`<!doctype html>
      <html lang="ja">
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width" />
        <title>${title} - Slide</title>
        ${style}
        <body>
          ${body}
        </body>
      </html>`,
    status,
  )
}

export const signInPrompt = html`<h1>Slide</h1>
  <p>本人の GitHub アカウントでログインしてください。</p>
  <p><a href="/auth/github">GitHub でログイン</a></p>`

export const notFoundBody = html`<h1>デッキが見つかりません</h1>
  <p><a href="/decks">デッキ一覧</a></p>`

const logoutForm = html`<form method="post" action="/auth/logout">
  <button>ログアウト</button>
</form>`

export function deckListBody(
  login: string,
  decks: readonly {
    deck: string
    repository: string
    allowedRefs: readonly string[]
  }[],
): Html {
  const rows = decks.map(
    (deck) =>
      html`<tr>
        <td><a href="/decks/${deck.deck}">${deck.deck}</a></td>
        <td>${deck.repository}</td>
        <td>${deck.allowedRefs.map((ref) => html`<code>${ref}</code> `)}</td>
      </tr>`,
  )
  return html`<h1>デッキ</h1>
    <p>${login} としてログイン中</p>
    ${logoutForm}
    <table>
      <tr>
        <th>デッキ</th>
        <th>リポジトリ</th>
        <th>許可ブランチ</th>
      </tr>
      ${rows}
    </table>
    <h2>リポジトリを連携する</h2>
    <p>
      管理権限のあるリポジトリに GitHub App をインストールしてから連携します。
      送信を許可するブランチは空白かカンマで区切ります。
    </p>
    <form method="post" action="/decks/connect">
      <p>
        <label
          >デッキ ID
          <input
            name="deck"
            required
            pattern="[a-z0-9](?:[a-z0-9\\-]{0,62}[a-z0-9])?"
        /></label>
      </p>
      <p>
        <label
          >リポジトリ（owner/name） <input name="repository" required
        /></label>
      </p>
      <p>
        <label>ブランチ <input name="branches" value="main" required /></label>
      </p>
      <button>GitHub で確認して連携する</button>
    </form>`
}

const date = (seconds: number | null) =>
  seconds === null ? '' : new Date(seconds * 1000).toISOString()

function filesCell(entry: HistoryEntry) {
  const { files } = entry
  const missing = files.missing.length
    ? html`<details>
        <summary>
          未受領 ${files.missing.length + files.missingNotShown} 件
        </summary>
        <ul>
          ${files.missing.map((path) => html`<li><code>${path}</code></li>`)}
        </ul>
        ${files.missingNotShown ? html`<p>ほか ${files.missingNotShown} 件</p>` : ''}
      </details>`
    : ''
  return html`${files.received} / ${files.total}${missing}`
}

export function historyBody(
  deck: string,
  entries: readonly HistoryEntry[],
  olderCursor: string | null,
  publication: Readonly<{
    state: DeckPublication
    result: ResultMessage | null
  }>,
): Html {
  const rows = entries.map(
    (entry) =>
      html`<tr>
        <td>
          <code>${entry.commit.slice(0, 12)}</code><br /><code
            >${entry.ref}</code
          >
        </td>
        <td>
          ${stateLabel(entry.state)}
          ${
            entry.failureReason
              ? html`<div class="reason">
                  ${reasonLabel(entry.failureReason)}
                </div>`
              : ''
          }
        </td>
        <td>${filesCell(entry)}</td>
        <td>${date(entry.createdAt)}</td>
        <td><code>${entry.deploymentId}</code></td>
        <td>${deploymentActions(deck, publication.state, entry)}</td>
      </tr>`,
  )
  return html`<p><a href="/decks">デッキ一覧</a></p>
    <h1>${deck}</h1>
    ${publicationPanel(deck, publication.state, entries, publication.result)}
    <h2>受領履歴</h2>
    <p>
      受領完了の版は、一般公開するまで作者だけが開けます。作者限定で開くと別の
      tab で表示し、この画面は残ります。
    </p>
    <table>
      <tr>
        <th>commit / ref</th>
        <th>状態</th>
        <th>ファイル</th>
        <th>開始</th>
        <th>deployment</th>
        <th>公開</th>
      </tr>
      ${
        rows.length
          ? rows
          : html`<tr>
              <td colspan="6">まだ受領した版はありません。</td>
            </tr>`
      }
    </table>
    ${
      olderCursor
        ? html`<p>
            <a href="/decks/${deck}?before=${encodeURIComponent(olderCursor)}"
              >さらに古い版</a
            >
          </p>`
        : ''
    }`
}
