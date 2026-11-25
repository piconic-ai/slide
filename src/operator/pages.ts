import { SERVICE_NAME } from '../site/service'
import { html } from 'hono/html'
import { REMOVAL_REASON_MAX } from '../profile/picture-removal'
import { TAKEDOWN_REASON_MAX } from '../publication/takedown'
import { MAX_TITLE_LENGTH } from '../links/link'
import type { ReportReason } from '../reports/report'
import type { ReportedDeck } from '../reports/store'
import type { Invite } from '../auth/invites-store'
import type { Operator } from './access'
import type { HiddenDeck, SuspendedAccount } from './store'
import { designTokensCssRaw } from '../site/design-tokens'
import type { OperatorCommunity } from '../communities/admin-store'
import { operatorCommunitiesSection } from '../communities/operator-page'

/** No script, no image, and no framing: the pages are plain forms. */
export const OPERATOR_PAGE_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"

const resultText = {
  hidden: '非表示にしました。',
  released: '非表示を解除しました。',
  suspended: 'アカウントを停止しました。',
  suspension_released: 'アカウントの停止を解除しました。',
  picture_removed:
    'アップロードしたプロフィール画像を外しました。その人のプロフィール画像は、Gravatar の画像か頭文字に戻ります。',
  no_picture:
    'その人は、プロフィール画像をアップロードしていません。変更していません。',
  invited: '招待の一覧に足しました。',
  invite_removed: '招待の一覧から外しました。',
  invalid_email: 'メールアドレスの形式が正しくありません。',
  unchanged: 'すでにその状態です。変更していません。',
  invalid_target:
    '対象を特定できませんでした。スライドは共有 URL または @handle/slug、アカウントは @handle またはプロフィール URL で入力してください。',
  invalid_reason: `理由を 1〜${TAKEDOWN_REASON_MAX} 文字で入力してください。`,
  not_found: '対象のスライドまたはアカウントは見つかりませんでした。',
  event_renamed: 'イベント名を直しました。',
  invalid_event:
    'イベントを特定できませんでした。イベントのページの URL か番号で入力してください。',
  invalid_event_name: `イベント名を 1〜${MAX_TITLE_LENGTH} 文字で入力してください。改行などの制御文字は使えません。`,
  event_not_found: 'そのイベントは見つかりませんでした。',
  community_admin_added: '管理者を足しました。',
  community_admin_removed: '管理者から外しました。',
  community_admin_last:
    '最後の管理者は外せません。先に新しい人を管理者に足してください。',
  community_person_unknown:
    'その人が見つからないか、そのコミュニティの管理者ではありません。',
  community_renamed: 'コミュニティのハンドルを変えました。',
  community_handle_taken: 'そのハンドルは、すでに使われています。',
  community_handle_held:
    'そのハンドルは、手放されてから 90 日の間は選べません。',
  community_handle_invalid: '新しいハンドルの形が正しくないか、予約語です。',
  community_deleted: 'コミュニティを削除しました。',
  community_not_found: 'そのハンドルのコミュニティは見つかりませんでした。',
  community_confirm_mismatch:
    '確認のハンドルが一致しません。削除していません。',
} as const
export type OperatorResultMessage = keyof typeof resultText

/** Bands for a result. The paragraph keeps `role="status"`. */
const resultNotice = {
  hidden: 'notice-success',
  released: 'notice-success',
  suspended: 'notice-success',
  suspension_released: 'notice-success',
  picture_removed: 'notice-success',
  no_picture: 'notice-warning',
  invited: 'notice-success',
  invite_removed: 'notice-success',
  invalid_email: 'notice-danger',
  unchanged: 'notice-warning',
  invalid_target: 'notice-danger',
  invalid_reason: 'notice-danger',
  not_found: 'notice-danger',
  event_renamed: 'notice-success',
  invalid_event: 'notice-danger',
  invalid_event_name: 'notice-danger',
  event_not_found: 'notice-danger',
  community_admin_added: 'notice-success',
  community_admin_removed: 'notice-success',
  community_admin_last: 'notice-danger',
  community_person_unknown: 'notice-danger',
  community_renamed: 'notice-success',
  community_handle_taken: 'notice-danger',
  community_handle_held: 'notice-danger',
  community_handle_invalid: 'notice-danger',
  community_deleted: 'notice-success',
  community_not_found: 'notice-danger',
  community_confirm_mismatch: 'notice-danger',
} as const satisfies Record<OperatorResultMessage, string>

const cell = (label: string, value: string | ReturnType<typeof html>) =>
  html`<td><span class="cell-label">${label}</span>${value}</td>`

export function parseOperatorResult(
  value: string | undefined,
): OperatorResultMessage | null {
  return value !== undefined && value in resultText
    ? (value as OperatorResultMessage)
    : null
}

const date = (seconds: number) => new Date(seconds * 1000).toISOString()

const reportReasonLabel = {
  nuisance: '迷惑行為',
  rights: '権利侵害',
  other: 'その他',
} satisfies Record<ReportReason, string>

const reportedRow = (deck: ReportedDeck) =>
  html`<tr>
    ${cell('スライド', html`<code>@${deck.handle}/${deck.slug}</code>`)}
    ${cell('人数', String(deck.reporters))}
    ${cell(
      '通報',
      html`${deck.reports.map(
        (report) =>
          html`<div>
            ${reportReasonLabel[report.reason]} ${report.note}
            ${date(report.updatedAt)}
          </div>`,
      )}`,
    )}
    ${cell('最後の通報', date(deck.lastReportedAt))}
  </tr>`

const hiddenRow = (deck: HiddenDeck) =>
  html`<tr>
    ${cell('スライド', html`<code>@${deck.handle}/${deck.slug}</code>`)}
    ${cell('理由', deck.takedown.reason)}
    ${cell('日時', date(deck.takedown.hiddenAt))}
    ${cell('操作者', deck.takedown.operator)}
    <td>
      <form method="post" action="/takedowns/${deck.deckId}/release">
        <button class="button-secondary">解除する</button>
      </form>
    </td>
  </tr>`

export type OperatorHomeView = Readonly<{
  operator: Operator
  reported: readonly ReportedDeck[]
  hidden: readonly HiddenDeck[]
  suspended: readonly SuspendedAccount[]
  invites: readonly Invite[]
  total: number
  page: number
  pages: number
  result: OperatorResultMessage | null
  /** The communities and the operations on them. */
  communities?: readonly OperatorCommunity[]
}>

const suspendedRow = (account: SuspendedAccount) =>
  html`<tr>
    ${cell(
      'アカウント',
      account.handle === null
        ? `退会済み（ID: ${account.userId}）`
        : `@${account.handle}`,
    )}
    ${cell('停止の理由', account.suspension.reason)}
    ${cell('停止日時', date(account.suspension.suspendedAt))}
    ${cell('停止した人', account.suspension.operator)}
    <td>
      <form method="post" action="/suspensions/${account.userId}/release">
        <button class="button-secondary">停止を解除する</button>
      </form>
    </td>
  </tr>`

const suspensionSections = (suspended: readonly SuspendedAccount[]) =>
  html`<h2>アカウントを停止する</h2>
    <form method="post" action="/suspensions">
      <p>
        <label for="suspension-target"
          >アカウント名、またはプロフィール URL</label
        >
        <input
          class="text-input"
          id="suspension-target"
          name="target"
          type="text"
          required
        />
      </p>
      <p>
        <label for="suspension-reason">停止の理由</label>
        <textarea
          class="text-input"
          id="suspension-reason"
          name="reason"
          rows="3"
          maxlength="${TAKEDOWN_REASON_MAX}"
          required
        ></textarea>
      </p>
      <button class="button-secondary">アカウントを停止する</button>
    </form>
    <h2>停止中のアカウント（${suspended.length} 件）</h2>
    <table class="data-table">
      <tr>
        <th>アカウント</th>
        <th>停止の理由</th>
        <th>停止日時</th>
        <th>停止した人</th>
        <th></th>
      </tr>
      ${
        suspended.length
          ? suspended.map(suspendedRow)
          : html`<tr>
              <td colspan="5">停止中のアカウントはありません。</td>
            </tr>`
      }
    </table>`

const eventSection = () =>
  html`<h2>イベント名を直す</h2>
    <p>
      コミュニティの無いイベントの名前を、お問い合わせを受けて直します。直した名前が、イベントのページと一覧に出ます。直した人と日時は記録に残ります。
    </p>
    <form method="post" action="/events/rename">
      <p>
        <label for="event-target">イベントのページの URL、または番号</label>
        <input
          class="text-input"
          id="event-target"
          name="target"
          type="text"
          required
        />
      </p>
      <p>
        <label for="event-name">イベント名</label>
        <input
          class="text-input"
          id="event-name"
          name="name"
          type="text"
          maxlength="${MAX_TITLE_LENGTH}"
          required
        />
      </p>
      <button class="button-secondary">イベント名を直す</button>
    </form>`

const pictureSection = () =>
  html`<h2>プロフィール画像を外す</h2>
    <p>
      その人がアップロードしたプロフィール画像を外します。外すと、Gravatar
      の画像があればそれ、なければ頭文字が出ます。外した人、理由、日時は記録に残ります。
    </p>
    <form method="post" action="/pictures/remove">
      <p>
        <label for="picture-target">アカウント名、またはプロフィール URL</label>
        <input
          class="text-input"
          id="picture-target"
          name="target"
          type="text"
          required
        />
      </p>
      <p>
        <label for="picture-reason">外す理由</label>
        <textarea
          class="text-input"
          id="picture-reason"
          name="reason"
          rows="3"
          maxlength="${REMOVAL_REASON_MAX}"
          required
        ></textarea>
      </p>
      <button class="button-secondary">プロフィール画像を外す</button>
    </form>`

const inviteRow = (invite: Invite) =>
  html`<tr>
    ${cell('メールアドレス', invite.email)}
    ${cell('招待した日時', date(invite.invitedAt))}
    ${cell('招待した人', invite.invitedBy)}
    <td>
      <form method="post" action="/invites/remove">
        <input type="hidden" name="email" value="${invite.email}" />
        <button class="button-secondary">外す</button>
      </form>
    </td>
  </tr>`

const inviteSections = (invites: readonly Invite[]) =>
  html`<h2>招待するメールアドレス</h2>
    <p>
      ここに載っているメールアドレスだけが、ログインできます。外すと、その人のログイン済みの状態は次の操作で切れます。公開済みのスライドは残ります。
    </p>
    <form method="post" action="/invites">
      <p>
        <label for="invite-email">メールアドレス</label>
        <input
          class="text-input"
          id="invite-email"
          name="email"
          type="email"
          required
          maxlength="254"
        />
      </p>
      <button class="button-secondary">招待する</button>
    </form>
    <h2>招待している人（${invites.length} 件）</h2>
    <table class="data-table">
      <tr>
        <th>メールアドレス</th>
        <th>招待した日時</th>
        <th>招待した人</th>
        <th></th>
      </tr>
      ${
        invites.length
          ? invites.map(inviteRow)
          : html`<tr>
              <td colspan="4">招待している人はいません。</td>
            </tr>`
      }
    </table>`

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
        <title>運営 - ${SERVICE_NAME}</title>
        <style>
          ${designTokensCssRaw} body {
            max-width: 960px;
            margin: 4vh auto;
            padding: 0 16px;
            color: var(--foreground);
            background: var(--background);
            font-family: var(--font-sans);
            font-size: 16px;
            font-weight: 400;
            line-height: 1.8;
            overflow-wrap: anywhere;
          }
          h1 {
            font-size: 32px;
            font-weight: 700;
            line-height: 1.35;
          }
          h2 {
            font-size: 24px;
            font-weight: 700;
            line-height: 1.4;
          }
          a {
            color: var(--foreground);
          }
          label {
            display: block;
            margin-bottom: 4px;
            font-size: 14px;
            font-weight: 600;
            line-height: 1.7;
          }
          .text-input {
            box-sizing: border-box;
            width: 100%;
            padding: 10px 12px;
            border: 1px solid var(--input);
            border-radius: var(--radius);
            background: var(--background);
            color: var(--foreground);
            font: 16px/1.8 var(--font-sans);
          }
          .text-input:focus {
            border: 2px solid var(--foreground);
            outline: none;
          }
          .button-secondary {
            display: inline-block;
            box-sizing: border-box;
            min-height: 40px;
            padding: 9px 19px;
            border: 1px solid var(--input);
            border-radius: var(--radius-full);
            background: var(--background);
            color: var(--foreground);
            font: 600 15px/1.2 var(--font-sans);
            text-align: center;
            cursor: pointer;
          }
          .button-secondary:hover {
            background: var(--secondary);
          }
          .data-table {
            width: 100%;
            border-collapse: collapse;
            background: var(--background);
          }
          .data-table th,
          .data-table td {
            padding: 8px 8px 8px 0;
            border-bottom: 1px solid var(--border);
            text-align: left;
            vertical-align: top;
            overflow-wrap: anywhere;
          }
          .data-table th {
            color: var(--muted-foreground);
            font-size: 13px;
            font-weight: 600;
            line-height: 1.6;
          }
          code {
            font-family: var(--font-mono);
            font-size: 13px;
            line-height: 1.6;
          }
          .cell-label {
            display: none;
          }
          .notice-success,
          .notice-warning,
          .notice-danger {
            border: 1px solid;
            border-radius: var(--radius);
            padding: 12px 16px;
            font-size: 14px;
            font-weight: 400;
            line-height: 1.7;
          }
          .notice-success {
            border-color: var(--success);
            background: var(--success-soft);
            color: var(--success);
          }
          .notice-warning {
            border-color: var(--warning);
            background: var(--warning-soft);
            color: var(--warning);
          }
          .notice-danger {
            border-color: var(--destructive);
            background: var(--destructive-soft);
            color: var(--destructive);
          }
          :focus-visible {
            outline: 2px solid var(--ring);
            outline-offset: 2px;
          }
          @media (max-width: 599px) {
            .data-table th {
              position: absolute;
              width: 1px;
              height: 1px;
              padding: 0;
              overflow: hidden;
              clip: rect(0, 0, 0, 0);
              white-space: nowrap;
              border: 0;
            }
            .data-table,
            .data-table tbody,
            .data-table tr,
            .data-table td {
              display: block;
              width: auto;
            }
            .data-table tr {
              padding: 8px 0 12px;
              border-bottom: 1px solid var(--border);
            }
            .data-table td {
              border: 0;
              padding: 4px 0;
            }
            .cell-label {
              display: block;
              color: var(--muted-foreground);
              font-size: 13px;
              font-weight: 600;
              line-height: 1.6;
            }
          }
        </style>
      </head>
      <body>
        <h1>運営</h1>
        <p>${view.operator.email} として操作しています。</p>
        ${
          view.result
            ? html`<p class="${resultNotice[view.result]}" role="status">
                ${resultText[view.result]}
              </p>`
            : ''
        }
        <h2>スライドを非表示にする</h2>
        <p>
          非表示にすると、共有
          URL、配信、表紙、一覧のすべてで読めなくなります。作者も開けません。作者の管理画面には、非表示にしたことと、ここに書いた理由が出ます。
        </p>
        <form method="post" action="/takedowns">
          <p>
            <label for="target">共有 URL、または @handle/slug</label>
            <input
              class="text-input"
              id="target"
              name="target"
              type="text"
              required
            />
          </p>
          <p>
            <label for="reason">理由（作者に見えます）</label>
            <textarea
              class="text-input"
              id="reason"
              name="reason"
              rows="3"
              maxlength="${TAKEDOWN_REASON_MAX}"
              required
            ></textarea>
          </p>
          <button class="button-secondary">非表示にする</button>
        </form>
        <h2>通報されたスライド（${view.reported.length} 件）</h2>
        <table class="data-table">
          <tr>
            <th>スライド</th>
            <th>人数</th>
            <th>通報</th>
            <th>最後の通報</th>
          </tr>
          ${
            view.reported.length
              ? view.reported.map(reportedRow)
              : html`<tr>
                  <td colspan="4">通報されたスライドはありません。</td>
                </tr>`
          }
        </table>
        <h2>非表示にしているスライド（${view.total} 件）</h2>
        <table class="data-table">
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
        ${pager(view)} ${suspensionSections(view.suspended)} ${pictureSection()}
        ${eventSection()} ${operatorCommunitiesSection(view.communities ?? [])}
        ${inviteSections(view.invites)}
      </body>
    </html>`
