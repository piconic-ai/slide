import { html } from 'hono/html'
import { formatJst, reasonLabel } from '../maintenance/maintenance-text'
import {
  EMPTY_FORM,
  type MaintenanceNotice,
  type NoticeForm,
  type NoticeProblem,
} from '../maintenance/notice'
import { MAINTENANCE_REASONS, isReason } from '../maintenance/switch'
import { ENTRANCE_PATH } from '../maintenance/entrance-path'
import { operatorFrame } from './operator-frame'

/** What happened to the last form sent, shown once after the page reloads. */
export const NOTICE_RESULTS = [
  'saved',
  'saved_soon',
  'cleared',
  'nothing_to_clear',
] as const
export type NoticeResult = (typeof NOTICE_RESULTS)[number]

/** The result named in the address, or null for anything else. */
export const parseNoticeResult = (value: unknown): NoticeResult | null =>
  (NOTICE_RESULTS as readonly unknown[]).includes(value)
    ? (value as NoticeResult)
    : null

/**
 * What the frame shows: the plan that is stored, whether its band is out now,
 * and the form (blank, or what the operator typed with what is wrong with it).
 */
export type MaintenanceFrameView = Readonly<{
  kind: 'ready'
  current: MaintenanceNotice | null
  /** Whether the band is shown at this moment: the end is still ahead. */
  shown: boolean
  form: NoticeForm
  problem: NoticeProblem | null
  result: NoticeResult | null
}>

/** The frame as the page first opens, before anything is sent. */
export const readyView = (
  current: MaintenanceNotice | null,
  shown: boolean,
): MaintenanceFrameView => ({
  kind: 'ready',
  current,
  shown,
  form: EMPTY_FORM,
  problem: null,
  result: null,
})

/** Where the steps of switching are (F38-AC8). */
export const SWITCH_STEPS =
  'https://github.com/piconic-ai/slide/blob/main/docs/dev/deploy.md#メンテナンス作業-n'

const RESULT_TEXT: Readonly<Record<NoticeResult, string>> = {
  saved:
    '予告を出しました。全ページの上に帯が出ます。反映には最大 1 分ほどかかります。',
  saved_soon:
    '予告を出しました。ただし、開始まで 3 日を切っています。利用者が知る時間は短くなります。',
  cleared: '予告を消しました。',
  nothing_to_clear: '出している予告はありません。',
}

const PROBLEM_TEXT: Readonly<Record<NoticeProblem, string>> = {
  starts_at: '開始の見込みを、日本時間の日付と時刻で入れてください。',
  ends_at: '終了の見込みを、日本時間の日付と時刻で入れてください。',
  reason: '理由の区分を選んでください。',
  order: '終了の見込みを、開始の見込みより後にしてください。',
  ended: '終了の見込みを、いまより後にしてください。',
  too_far: '終了の見込みが先すぎます。90 日以内にしてください。',
}

/** The field a problem is shown under. */
const FIELD_OF: Readonly<
  Record<NoticeProblem, 'starts_at' | 'ends_at' | 'reason'>
> = {
  starts_at: 'starts_at',
  ends_at: 'ends_at',
  reason: 'reason',
  order: 'ends_at',
  ended: 'ends_at',
  too_far: 'ends_at',
}

const problemFor = (
  view: MaintenanceFrameView,
  field: 'starts_at' | 'ends_at' | 'reason',
) =>
  view.problem !== null && FIELD_OF[view.problem] === field
    ? html`<p class="notice-danger" id="notice-${field}-problem" role="alert">
        ${PROBLEM_TEXT[view.problem]}
      </p>`
    : ''

const current = (view: MaintenanceFrameView) => {
  const notice = view.current
  if (notice === null) return html`<p>出している予告はありません。</p>`
  return html`<p>
      ${formatJst(notice.startsAt, 'ja')} から ${formatJst(notice.endsAt, 'ja')}
      まで(日本時間)、${reasonLabel(notice.reason, 'ja')}。
    </p>
    <p>
      ${
        view.shown
          ? '全ページの上に帯が出ています。'
          : '終了の見込みを過ぎているので、帯は出ていません。'
      }
    </p>`
}

const noticeClass = (result: NoticeResult) =>
  result === 'saved_soon' ? 'notice-warning' : 'notice-success'

/**
 * The frame "メンテナンスの予定" of the operations page (02-PAGES 16.1): the
 * plan that is out now, the form that puts a plan in (F38-AC1, AC6, AC7), the
 * button that takes it away (F38-AC5), and where the steps of switching are
 * (F38-AC8). Times are Japan time.
 */
export const maintenanceFrame = (
  view: MaintenanceFrameView,
): ReturnType<typeof html> =>
  operatorFrame(
    { id: 'maintenance', heading: 'メンテナンスの予定' },
    html`${
        view.result === null
          ? ''
          : html`<p class="${noticeClass(view.result)}" role="status">
              ${RESULT_TEXT[view.result]}
            </p>`
      }
      <h3>いま出している予告</h3>
      ${current(view)}
      <h3>予告を出す</h3>
      <p>
        予告を出すと、終了の見込みまで、全ページの上に帯が出ます。予定は 1
        つだけ持ち、新しい予定は前の予定を置き換えます。日時は日本時間です。
      </p>
      <form method="post" action="/operations/maintenance" novalidate>
        <p>
          <label for="notice-starts-at">開始の見込み</label>
          <input
            class="text-input"
            id="notice-starts-at"
            name="starts_at"
            type="datetime-local"
            required
            value="${view.form.startsAt}"
            aria-describedby="notice-starts_at-problem"
          />
        </p>
        ${problemFor(view, 'starts_at')}
        <p>
          <label for="notice-ends-at">終了の見込み</label>
          <input
            class="text-input"
            id="notice-ends-at"
            name="ends_at"
            type="datetime-local"
            required
            value="${view.form.endsAt}"
            aria-describedby="notice-ends_at-problem"
          />
        </p>
        ${problemFor(view, 'ends_at')}
        <p>
          <label for="notice-reason">理由の区分</label>
          <select
            class="text-input"
            id="notice-reason"
            name="reason"
            required
            aria-describedby="notice-reason-problem"
          >
            <option value="" ${view.form.reason === '' ? 'selected' : ''}>
              選んでください
            </option>
            ${MAINTENANCE_REASONS.map(
              (reason) =>
                html`<option
                  value="${reason}"
                  ${
                    isReason(view.form.reason) && view.form.reason === reason
                      ? 'selected'
                      : ''
                  }
                >
                  ${reasonLabel(reason, 'ja')}
                </option>`,
            )}
          </select>
        </p>
        ${problemFor(view, 'reason')}
        <p>
          <button class="button-secondary" type="submit">予告を出す</button>
        </p>
      </form>
      <form method="post" action="/operations/maintenance/clear">
        <p>
          <button class="button-secondary" type="submit">予告を消す</button>
        </p>
      </form>
      <p>
        止める・終える手順は、<a
          href="${SWITCH_STEPS}"
          rel="noopener noreferrer"
          >本番に反映する(メンテナンス)</a
        >
        にあります。予告を出しても、サービスは止まりません。止めるのは secret
        <code>MAINTENANCE</code> です。
      </p>
      <p>
        止めているあいだに、管理 origin の画面を確かめるには、運営の画面と同じ
        origin の <code>${ENTRANCE_PATH}</code>
        を開きます。Access を通った運営だけが、1 時間、管理 origin
        の画面を開けます。
      </p>`,
  )
