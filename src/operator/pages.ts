import { html } from 'hono/html'
import { TAKEDOWN_REASON_MAX } from '../publication/takedown'
import type { Operator } from './access'
import type { HiddenDeck } from './store'

/** No script, no image, and no framing: the pages are plain forms. */
export const OPERATOR_PAGE_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"

const resultText = {
  hidden: '非表示にしました。',
  released: '非表示を解除しました。',
  unchanged: 'すでにその状態です。変更していません。',
  invalid_target:
    'スライドを特定できませんでした。共有 URL、または @handle/slug の形で入力してください。',
  invalid_reason: `理由を 1〜${TAKEDOWN_REASON_MAX} 文字で入力してください。`,
  not_found: 'そのスライドは見つかりませんでした。',
} as const
export type OperatorResultMessage = keyof typeof resultText

export function parseOperatorResult(
  value: string | undefined,
): OperatorResultMessage | null {
  return value !== undefined && value in resultText
    ? (value as OperatorResultMessage)
    : null
}

const date = (seconds: number) => new Date(seconds * 1000).toISOString()

const hiddenRow = (deck: HiddenDeck) =>
  html`<tr>
    <td><code>@${deck.handle}/${deck.deckId}</code></td>
    <td>${deck.takedown.reason}</td>
    <td>${date(deck.takedown.hiddenAt)}</td>
    <td>${deck.takedown.operator}</td>
    <td>
      <form method="post" action="/takedowns/${deck.deckId}/release">
        <button>解除する</button>
      </form>
    </td>
  </tr>`

export type OperatorHomeView = Readonly<{
  operator: Operator
  hidden: readonly HiddenDeck[]
  total: number
  page: number
  pages: number
  result: OperatorResultMessage | null
}>

const pager = (view: OperatorHomeView) =>
  view.pages <= 1
    ? ''
    : html`<nav aria-label="非表示にしているスライドのページ">
        <p>
          ${view.page} / ${view.pages} ページ
          ${view.page > 1 ? html`<a href="/?page=${view.page - 1}">新しいほうへ</a>` : ''}
          ${view.page < view.pages ? html`<a href="/?page=${view.page + 1}">古いほうへ</a>` : ''}
        </p>
      </nav>`

/** The operator's page: hide a deck, and the decks hidden now. */
export const operatorHome = (view: OperatorHomeView) =>
  html`<!doctype html>
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>運営 - slide</title>
        <style>
          body {
            font-family: system-ui, sans-serif;
            line-height: 1.7;
            max-width: 60rem;
            margin: 0 auto;
            padding: 1rem;
          }
          table {
            border-collapse: collapse;
            width: 100%;
          }
          th,
          td {
            border-bottom: 1px solid #ccc;
            padding: 0.4rem 0.6rem 0.4rem 0;
            text-align: left;
            vertical-align: top;
            overflow-wrap: anywhere;
          }
          input[type='text'],
          textarea {
            width: 100%;
            box-sizing: border-box;
            font: inherit;
          }
        </style>
      </head>
      <body>
        <h1>運営</h1>
        <p>${view.operator.email} として操作しています。</p>
        ${view.result ? html`<p role="status">${resultText[view.result]}</p>` : ''}
        <h2>スライドを非表示にする</h2>
        <p>
          非表示にすると、共有
          URL、配信、表紙、一覧のすべてで読めなくなります。作者も開けません。作者の管理画面には、非表示にしたことと、ここに書いた理由が出ます。
        </p>
        <form method="post" action="/takedowns">
          <p>
            <label for="target">共有 URL、または @handle/slug</label>
            <input id="target" name="target" type="text" required />
          </p>
          <p>
            <label for="reason">理由（作者に見えます）</label>
            <textarea
              id="reason"
              name="reason"
              rows="3"
              maxlength="${TAKEDOWN_REASON_MAX}"
              required
            ></textarea>
          </p>
          <button>非表示にする</button>
        </form>
        <h2>非表示にしているスライド（${view.total} 件）</h2>
        <table>
          <tr>
            <th>スライド</th>
            <th>理由</th>
            <th>日時</th>
            <th>操作者</th>
            <th></th>
          </tr>
          ${
            view.hidden.length
              ? view.hidden.map(hiddenRow)
              : html`<tr>
                  <td colspan="5">非表示にしているスライドはありません。</td>
                </tr>`
          }
        </table>
        ${pager(view)}
      </body>
    </html>`
