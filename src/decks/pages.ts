import type { Context } from 'hono'
import { html, raw } from 'hono/html'
import { siteFooter } from '../site/legal-pages'
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

const siteHeader = html`<header class="site-header">
  <a class="brand" href="/">Slide</a>
  <a href="/decks">デッキ管理</a>
</header>`

export function renderPage<E extends { Bindings: Env }>(
  c: Context<E>,
  title: string,
  body: Html,
  status: 200 | 400 | 401 | 404 = 200,
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
        <script src="/share.js" defer></script>
        <body>
          ${siteHeader} ${body} ${raw(siteFooter)}
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

const accountDeletion = (login: string) =>
  html`<h2>退会する</h2>
    <p>
      すべてのデッキを削除し、ログインを終えます。公開中の URL
      はすぐに読めなくなり、受領した版のファイルと記録は 24
      時間ほど後に消えます。元には戻せません。
    </p>
    <form method="post" action="/account/delete">
      <label
        >確認のため、GitHub のユーザー名
        <code>${login}</code> を入力してください
        <input name="confirm" autocomplete="off" required
      /></label>
      <button type="submit">退会する</button>
    </form>`

export const accountMismatchBody = html`<h1>退会できませんでした</h1>
  <p>入力したユーザー名が一致しません。何も削除していません。</p>
  <p><a href="/decks">デッキ一覧に戻る</a></p>`

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
    </form>
    ${accountDeletion(login)}`
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

const deletionSection = (deck: string) =>
  html`<h2>デッキを削除する</h2>
    <p>
      公開中の URL と作者限定の閲覧はすぐに読めなくなり、repository
      との連携も外れます。受領したすべての版のファイルと記録は、24
      時間ほど後に消えます。元には戻せません。
    </p>
    <form method="post" action="/decks/${deck}/delete">
      <label
        >確認のため、デッキ名 <code>${deck}</code> を入力してください
        <input name="confirm" autocomplete="off" required
      /></label>
      <button type="submit">削除する</button>
    </form>`

export const deletionMismatchBody = (deck: string) =>
  html`<h1>削除できませんでした</h1>
    <p>入力したデッキ名が一致しません。何も削除していません。</p>
    <p><a href="/decks/${deck}">デッキに戻る</a></p>`

export function historyBody(
  deck: string,
  entries: readonly HistoryEntry[],
  olderCursor: string | null,
  publication: PanelView,
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
        <td>${deploymentActions(deck, publication, entry)}</td>
      </tr>`,
  )
  return html`<p><a href="/decks">デッキ一覧</a></p>
    <h1>${deck}</h1>
    ${publicationPanel(deck, publication)}
    <h2>受領履歴</h2>
    ${
      publication.delivery
        ? html`<p>
            受領完了の版は、一般公開するまで作者だけが開けます。作者限定で開くと別の
            tab で表示し、この画面は残ります。
          </p>`
        : html`<p>受領完了の版は、一般公開するまで作者だけのものです。</p>`
    }
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
    }
    ${deletionSection(deck)}`
}
