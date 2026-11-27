import type { TransmissionText } from '../document'

/**
 * The text of the page "External transmission": the first edition, enacted
 * on 2026-11-27. The wording is the operator's. At the operator's request the
 * draft of 2026-11-26 was put into the polite form, and its lead sentence no
 * longer calls the page a draft; any other change of wording is the
 * operator's to decide. The same text, as Markdown, is
 * `../handed-over/external-transmission.md`, and a test compares the two.
 * How to replace it: docs/dev/f34-legal-pages.md.
 */
export const externalTransmission = {
  form: 'transmission',
  title: '外部への送信',
  description:
    'プライバシーポリシー第 6 条に基づき、本サービスがプライバシー情報を送る先と、送る情報と目的を示します。送り先が変わったときは、このページを更新します。',
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
  // The Markdown copy has no supplementary provisions, and the page needs a
  // date to leave the draft state (F34-AC6, F34-AC7). This line carries the
  // same date as the other two texts; it is not part of the Markdown copy.
  history: [{ date: '2026年11月27日', summary: '制定' }],
} as const satisfies TransmissionText
