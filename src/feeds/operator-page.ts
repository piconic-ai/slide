import { html } from 'hono/html'
import type { FeedFailure } from './feed-answer'
import type { StoppedFeed } from './store'

const date = (seconds: number) => new Date(seconds * 1000).toISOString()

/** Why a feed stopped, as the operator reads it. */
export const FAILURE_TEXT: Readonly<Record<FeedFailure, string>> = {
  refused: 'Luma のカレンダーの配信の URL の形ではありません。',
  redirect: 'リダイレクトが返りました(追っていません)。',
  http_error: 'エラーの応答が返りました。',
  rate_limited: '429(取得が多すぎる)が返りました。',
  unavailable: '503(一時的に使えない)が返りました。',
  too_large: '応答が 2 MB を超えたので打ち切りました。',
  timeout: '応答が 10 秒を超えたので打ち切りました。',
  network: 'Luma に届かないか、応答が途中で切れました。',
  not_calendar: '応答が iCal のカレンダーではありませんでした。',
}

const row = (feed: StoppedFeed) =>
  html`<tr>
    <td><code>${feed.url}</code></td>
    <td>
      ${
        feed.community === null
          ? 'なし(紐づけ用リンクが外れています)'
          : html`<code>@${feed.community}</code>`
      }
    </td>
    <td>${date(feed.stoppedAt)}</td>
    <td>${FAILURE_TEXT[feed.reason]}</td>
    <td>${feed.failures} 回</td>
    <td>
      <form method="post" action="/feeds/resume">
        <input type="hidden" name="url" value="${feed.url}" />
        <button class="button-secondary">再開する</button>
      </form>
    </td>
  </tr>`

/**
 * The stopped feeds on the operator's page (F33-AC9): each with the
 * community that holds it, when and why it stopped, and "resume". Nothing
 * of what a feed lists is shown (D-60).
 */
export const stoppedFeedsSection = (feeds: readonly StoppedFeed[]) =>
  html`<h2>止まった配信</h2>
    <p>
      Luma のカレンダーの配信のうち、5
      回続けて読めなかったものです。読むのを止めています。原因が解けたら「再開する」を押します。再開しても、最後に取りに行ってから
      1 時間と、Luma が
      <code>Retry-After</code> で示した時刻より前には読みません。
    </p>
    <table class="data-table">
      <tr>
        <th>配信</th>
        <th>コミュニティ</th>
        <th>止まった日時</th>
        <th>理由</th>
        <th>続けて失敗した回数</th>
        <th></th>
      </tr>
      ${
        feeds.length === 0
          ? html`<tr>
              <td colspan="6">止まった配信はありません。</td>
            </tr>`
          : feeds.map(row)
      }
    </table>`
