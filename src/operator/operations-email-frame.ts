import { html } from 'hono/html'
import type { EmailCryptoProblem } from '../db/email-cipher'
import { isDone, REWRITE_LIMIT, type EmailCounts } from '../db/email-rewrite'
import { operatorFrame } from './operator-frame'
import { notConfigured } from './not-configured'

/** Where the steps to set the keys, and to rotate them, are. */
const GUIDE = 'docs/dev/deploy.md#メールアドレスの暗号化の鍵作業-c'

/**
 * What the frame shows. `ready` is the keys set and fitting the data: which
 * versions it holds and which one writes, and how many rows are in each
 * state. Nothing here is an address, a sealed text or a key.
 */
export type EmailFrameView =
  | Readonly<{ kind: 'not_configured' }>
  | Readonly<{ kind: 'invalid'; problems: readonly EmailCryptoProblem[] }>
  | Readonly<{ kind: 'mismatch' }>
  | Readonly<{
      kind: 'ready'
      versions: readonly number[]
      current: number
      counts: EmailCounts
    }>

const SETTINGS = [
  'EMAIL_CIPHER_KEYS',
  'EMAIL_CIPHER_CURRENT',
  'EMAIL_LOOKUP_KEY',
] as const

const PROBLEM_TEXT: Record<EmailCryptoProblem, string> = {
  keys_missing: 'EMAIL_CIPHER_KEYS がありません',
  keys_malformed: 'EMAIL_CIPHER_KEYS の形が正しくありません',
  current_missing: 'EMAIL_CIPHER_CURRENT がありません',
  current_unknown:
    'EMAIL_CIPHER_CURRENT が、EMAIL_CIPHER_KEYS にない版を指しています',
  lookup_missing: 'EMAIL_LOOKUP_KEY がありません',
  lookup_malformed: 'EMAIL_LOOKUP_KEY の形が正しくありません',
  lookup_reused: 'EMAIL_LOOKUP_KEY が、暗号の鍵と同じです',
}

const rewriteForm = html`<form method="post" action="/operations/email/rewrite">
  <p>
    押すたびに、最大 ${REWRITE_LIMIT}
    件ずつ進みます。途中で止めても、エラーで止まっても、もう一度押すと続きから進みます。何度押しても、結果は同じです。
  </p>
  <p>
    押しても平文の行が減らないときは、書き換えられない行があります。見方は
    <code>${GUIDE}</code> の「失敗の見方」にあります。
  </p>
  <button class="button-secondary">書き換える</button>
</form>`

const ready = (view: Extract<EmailFrameView, { kind: 'ready' }>) => {
  const { counts } = view
  return html`<dl>
      <dt>鍵</dt>
      <dd>
        設定済み(版 ${view.versions.join('、')}。いま書く版は ${view.current})
      </dd>
      <dt>平文の行(残り)</dt>
      <dd>${counts.plain} 件</dd>
      <dt>古い版で暗号化した行</dt>
      <dd>${counts.olderVersion} 件</dd>
      <dt>いまの版で暗号化した行</dt>
      <dd>${counts.current} 件</dd>
    </dl>
    ${isDone(counts) ? html`<p>書き換える行はありません。</p>` : rewriteForm}`
}

/** The frame "メールアドレスの暗号化" of the operations page. */
export const emailFrame = (view: EmailFrameView): ReturnType<typeof html> => {
  const frame = { id: 'email', heading: 'メールアドレスの暗号化' }
  switch (view.kind) {
    case 'not_configured':
      return operatorFrame(frame, notConfigured(SETTINGS, GUIDE))
    case 'invalid':
      return operatorFrame(
        frame,
        html`<p class="not-configured" role="status">
          鍵の設定が正しくありません。${view.problems.map(
            (problem) => html`${PROBLEM_TEXT[problem]}。`,
          )}
          このあいだ、ログインはできません。設定の手順は
          <code>${GUIDE}</code> を見てください。
        </p>`,
      )
    case 'mismatch':
      return operatorFrame(
        frame,
        html`<p class="not-configured" role="status">
          設定した鍵が、保存されているデータと合いません。ログインと書き換えは止まっています。鍵を取り違えていないか、手順
          <code>${GUIDE}</code> を見て確かめてください。
        </p>`,
      )
    case 'ready':
      return operatorFrame(frame, ready(view))
  }
}
