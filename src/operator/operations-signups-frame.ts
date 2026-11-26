import { html } from 'hono/html'
import type { SignupMode } from '../auth/signup-mode'
import { operatorFrame } from './operator-frame'
import { timeTag } from './operator-time'

/** Where the steps to open, close and stop sign-up are. */
const GUIDE = 'docs/dev/deploy.md#登録を開く作業-r'

/**
 * What the frame shows: the setting `OPEN_SIGNUP` as it is (the page cannot
 * change it), whether the operator has stopped new sign-ups and since when,
 * and how many people registered lately. Counts only.
 */
export type SignupsFrameView = Readonly<{
  kind: 'ready'
  mode: SignupMode
  /** `null` when sign-up goes on; when it was stopped (seconds) otherwise. */
  pausedSince: number | null
  /** Registered within the last hour, and within the last 24 hours. */
  lastHour: number
  lastDay: number
}>

const pauseForm = html`<form method="post" action="/operations/signups/pause">
  <p>
    押すと、登録していないメールアドレスには、ログインのコードが送られなくなります。登録している人は、これまでどおりログインできます。
  </p>
  <button class="button-secondary">新しい登録を止める</button>
</form>`

const resumeForm = html`<form method="post" action="/operations/signups/resume">
  <p>
    押すと、新しい登録を受け付けます(設定が招待制のときは、招待されている人だけです)。
  </p>
  <button class="button-secondary">再開する</button>
</form>`

/**
 * The frame "新しい登録" of the operations page. The one button that is
 * pressed to stop, or to resume, is alone at the bottom of the frame
 * (F42-AC16).
 */
export const signupsFrame = (
  view: SignupsFrameView,
): ReturnType<typeof html> => {
  const paused = view.pausedSince !== null
  return operatorFrame(
    { id: 'signups', heading: '新しい登録' },
    html`<dl>
        <dt>招待制か</dt>
        <dd>
          ${view.mode === 'open' ? '開いている(招待なしで登録できる)' : '招待制'}
        </dd>
        <dt>新しい登録</dt>
        <dd>
          ${
            view.pausedSince === null
              ? '受け付けている'
              : html`止めている(${timeTag(view.pausedSince)}から)`
          }
        </dd>
        <dt>直近 1 時間の登録</dt>
        <dd>${view.lastHour} 人</dd>
        <dt>直近 24 時間の登録</dt>
        <dd>${view.lastDay} 人</dd>
      </dl>
      <p>
        招待制かどうかは、設定の値 <code>OPEN_SIGNUP</code>
        で決まり、この画面では変えられません。変え方は
        <code>${GUIDE}</code> を見てください。
      </p>
      ${paused ? resumeForm : pauseForm}`,
  )
}
