import type { TransmissionText } from '../document'

/**
 * The text of the page "External transmission", as handed over (the draft of 2026-11-26).
 * The wording is the operator's: do not correct it here. The same text, as
 * Markdown, is `../handed-over/external-transmission.md`, and a test compares the two.
 * How to replace it: docs/dev/f34-legal-pages.md.
 */
export const externalTransmission = {
  form: 'transmission',
  title: '外部への送信',
  description:
    'プライバシーポリシー第 6 条から参照する別ページの下書きである。送り先が変わったときは、このページだけを更新する。',
  columns: ['送り先', '送る情報', '目的', 'その事業者のポリシー'],
  rows: [
    {
      destination: 'Cloudflare, Inc.(米国)',
      information: '本サービスで扱うすべての情報',
      purpose:
        '本サービスの配信と保存、ログインのコードとお知らせのメールの送信、不正な利用を防ぐための確認',
      policy: {
        label: 'プライバシーポリシー',
        url: 'https://www.cloudflare.com/privacypolicy/',
      },
    },
    {
      destination: 'Automattic Inc.(Gravatar、米国)',
      information: 'メールアドレスから作ったハッシュ値',
      purpose: '顔写真を登録していない登録者の既定の画像の表示',
      policy: {
        label: 'プライバシーポリシー',
        url: 'https://automattic.com/privacy/',
      },
    },
  ],
  // The handed-over text has no supplementary provisions, and the page needs
  // a date to leave the draft state (F34-AC6, F34-AC7). This line is the same
  // blank the other two texts carry; it is not part of the handed-over text.
  history: [{ date: '(施行日)', summary: '制定' }],
} as const satisfies TransmissionText
