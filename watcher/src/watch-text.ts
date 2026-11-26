import type { Action } from './watch-step'
import type { TargetName } from './watch-config'
import type { MaintenancePhase } from './watch-maintenance'

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

const MAINTENANCE_TITLES: Readonly<Record<MaintenancePhase, string>> = {
  started: 'メンテナンスが始まりました',
  ended: 'メンテナンスが終わりました',
  overrun: 'メンテナンスが終わる見込みを過ぎています',
}

/** Where the steps for maintenance are (D-63). */
const MAINTENANCE_STEPS = 'docs/dev/alerts-runbook.md#maintenance'

const two = (n: number) => String(n).padStart(2, '0')

/**
 * The end as `2026-12-01 12:00 JST(03:00 UTC)`. The time is the only thing
 * of the maintenance that is told: Japan time, which the operator thinks in,
 * and UTC, which the secret is written in.
 */
export function endText(seconds: number): string {
  const utc = new Date(seconds * 1000)
  const jst = new Date((seconds + 9 * 3600) * 1000)
  const date = `${jst.getUTCFullYear()}-${two(jst.getUTCMonth() + 1)}-${two(jst.getUTCDate())}`
  return `${date} ${two(jst.getUTCHours())}:${two(jst.getUTCMinutes())} JST(${two(utc.getUTCHours())}:${two(utc.getUTCMinutes())} UTC)`
}

/**
 * The message for maintenance that started, ran past its end, or ended
 * (D-120): what happened, the expected end when it is known, and where the
 * steps are. Nothing of who or where.
 */
export function maintenanceMessageOf(
  phase: MaintenancePhase,
  until: number | null,
): string {
  return [
    `[slide 見張り] ${MAINTENANCE_TITLES[phase]}`,
    ...(until === null ? [] : [`終わる見込み: ${endText(until)}`]),
    `手順: ${MAINTENANCE_STEPS}`,
  ].join('\n')
}
