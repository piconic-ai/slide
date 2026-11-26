import type { AlertKind, Notice } from './notice'

type KindText = Readonly<{ title: string; unit: string }>

/**
 * What each kind is called, and what its count counts. Fixed text: the
 * words of an alert come from here and from nothing a person typed.
 */
const KIND_TEXT: Readonly<Record<AlertKind, KindText>> = {
  page_unreachable: { title: 'ページが開けません', unit: '回' },
  login_mail_failed: {
    title: 'ログインのメールの送信に失敗しています',
    unit: '回',
  },
  signup_surge: { title: '新しい登録が急に増えています', unit: '件' },
  mail_flood: { title: 'ログインのメールが多く送られています', unit: '通' },
  maintenance: { title: 'メンテナンスの知らせ', unit: '' },
  deploy_check_failed: {
    title: '反映の後の確認に失敗しました',
    unit: '回',
  },
  cron_failed: { title: '定期の処理が失敗しました', unit: '回' },
  luma_feed_stopped: { title: 'Luma の配信が止まりました', unit: '件' },
  d1_size: { title: 'D1 の大きさがしきい値を超えました', unit: 'MB' },
  report_received: { title: '通報が届きました', unit: '件' },
  backup_failed: { title: 'バックアップに失敗しました', unit: '回' },
}

export const kindTitle = (kind: AlertKind) => KIND_TEXT[kind].title

/** `count` with the unit of the kind: "3 回". */
export const countText = (kind: AlertKind, count: number) => {
  const { unit } = KIND_TEXT[kind]
  return unit ? `${count} ${unit}` : String(count)
}

const IPV4 = /\d{1,3}(?:\.\d{1,3}){3}/
const IPV6 = /[0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{0,4}){2,}/

/**
 * Whether a text is free of what an alert must never hold (D-58): an `@`,
 * so no email address, and anything shaped like an IPv4 or IPv6 address.
 * The types of a notice already leave no room for them; this is the check
 * on the text that is about to leave.
 */
export const holdsNoPersonalData = (text: string) =>
  !text.includes('@') && !IPV4.test(text) && !IPV6.test(text)

const ORIGIN = /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+$/

/**
 * Where to look, as the operator can open it. A path of the operator page
 * becomes an address on the operator's origin when that is known; a path of a
 * document stays a path of the repository.
 */
export function linkText(link: string, operatorOrigin: string | null) {
  return link.startsWith('/') && operatorOrigin && ORIGIN.test(operatorOrigin)
    ? `${operatorOrigin}${link}`
    : link
}

/**
 * The message told at once: the kind, how many, and where to look. Null when
 * the text would hold what it must not, in which case nothing is sent.
 */
export function immediateText(
  notice: Notice,
  operatorOrigin: string | null,
): string | null {
  const text = [
    `[slide] ${kindTitle(notice.kind)}`,
    `件数: ${countText(notice.kind, notice.count)}`,
    `手順: ${linkText(notice.link, operatorOrigin)}`,
  ].join('\n')
  return holdsNoPersonalData(text) ? text : null
}
