import type { Action } from './watch-step'
import type { TargetName } from './watch-config'

const NAMES: Readonly<Record<TargetName, string>> = {
  top: 'トップ',
  viewer: 'viewer',
  content: '配信 origin',
}

/** Where the steps are, a path of a document in the repository (D-63). */
const STEPS = 'docs/dev/alerts-runbook.md#page-unreachable'

/**
 * The message for a notice (D-58): what it is about by a fixed name, how many
 * checks failed, and where the steps are. No address of a page, nobody's
 * name, nothing a request carried.
 */
export function messageOf(
  action: Exclude<Action, null>,
  target: TargetName,
  failures: number,
): string {
  return action === 'down'
    ? [
        `[slide 見張り] ページが開けません: ${NAMES[target]}`,
        `確認の失敗: ${failures} 回続けて`,
        `手順: ${STEPS}`,
      ].join('\n')
    : [
        `[slide 見張り] ページが開けるようになりました: ${NAMES[target]}`,
        `手順: ${STEPS}`,
      ].join('\n')
}
