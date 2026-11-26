import { messages, type Lang } from '../site/i18n'
import type { MaintenanceReason } from './switch'

const JST_OFFSET_SECONDS = 9 * 60 * 60

const MONTHS_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

const two = (n: number) => String(n).padStart(2, '0')

/**
 * A moment in Japan time, in the words of the screen language: `2026年12月1日
 * 12:00`, `Dec 1, 2026, 12:00 JST`. Written by hand from the date parts, so the
 * result does not depend on the locale data of the machine.
 */
export function formatJst(seconds: number, lang: Lang): string {
  const at = new Date((seconds + JST_OFFSET_SECONDS) * 1000)
  const [y, mo, d] = [at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()]
  const time = `${two(at.getUTCHours())}:${two(at.getUTCMinutes())}`
  return lang === 'ja'
    ? `${y}年${mo + 1}月${d}日 ${time}`
    : `${MONTHS_EN[mo]} ${d}, ${y}, ${time} JST`
}

/** A moment in UTC, `2026-12-01 03:00 UTC`: the same in every language. */
export function formatUtc(seconds: number): string {
  const at = new Date(seconds * 1000)
  return `${at.getUTCFullYear()}-${two(at.getUTCMonth() + 1)}-${two(at.getUTCDate())} ${two(at.getUTCHours())}:${two(at.getUTCMinutes())} UTC`
}

const reasonText = messages<
  Readonly<{
    label: Readonly<Record<MaintenanceReason, string>>
    sentence: Readonly<Record<MaintenanceReason, string>>
  }>
>({
  ja: {
    label: {
      database: 'データベースの保守',
      update: 'サービスの更新',
      other: 'その他',
    },
    sentence: {
      database: 'データベースの保守のため、サービスを止めています。',
      update: 'サービスの更新のため、サービスを止めています。',
      other: 'その他の作業のため、サービスを止めています。',
    },
  },
  en: {
    label: {
      database: 'Database maintenance',
      update: 'Service update',
      other: 'Other work',
    },
    sentence: {
      database: 'The service is stopped for database maintenance.',
      update: 'The service is stopped for an update.',
      other: 'The service is stopped for other work.',
    },
  },
})

/** A reason's name, as a list or a form shows it (F38-AC11). */
export const reasonLabel = (reason: MaintenanceReason, lang: Lang) =>
  reasonText[lang].label[reason]

/** The sentence that says why the service is stopped (F38-AC11). */
export const reasonSentence = (reason: MaintenanceReason, lang: Lang) =>
  reasonText[lang].sentence[reason]
