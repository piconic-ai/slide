import { html, raw } from 'hono/html'

/** Legal pages carry only service markup, so they allow nothing else. */
export const LEGAL_PAGE_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

export const legalKinds = ['terms', 'privacy', 'contact'] as const
export type LegalKind = (typeof legalKinds)[number]

type LegalContent = Readonly<{
  title: string
  /** What the final page will cover, until its text is decided. */
  sections: readonly string[]
}>

// Placeholders only: the wording is decided by a person before launch.
const content: Readonly<Record<LegalKind, LegalContent>> = {
  terms: {
    title: '利用規約',
    sections: [
      'サービスの内容と、利用できる人',
      'アカウントと、作者が送る資料の扱い',
      '禁止事項と、不正な資料への対応',
      'サービスの変更・停止と、免責',
      '規約の変更',
    ],
  },
  privacy: {
    title: 'プライバシーポリシー',
    sections: [
      '取得する情報（GitHub のアカウント情報、送られた資料、アクセスの記録）',
      '利用の目的',
      '保存の期間と、退会したときの削除',
      '利用する外部のサービス（Cloudflare、GitHub）と、やり取りする情報',
      'お問い合わせ',
    ],
  },
  contact: {
    title: 'お問い合わせ',
    sections: [
      'サービスについての質問',
      '不正な資料の通報',
      '個人情報の扱いについての請求',
    ],
  },
}

export const legalPath = (kind: LegalKind) => `/${kind}`

/** Links to the legal pages, shown at the bottom of every service page. */
export const siteFooter = /* HTML */ `<footer
  style="margin-top: 48px; font-size: 14px; color: #4a5a70"
>
  <a href="/terms">利用規約</a> · <a href="/privacy">プライバシーポリシー</a> ·
  <a href="/contact">お問い合わせ</a>
</footer>`

export const legalPage = (kind: LegalKind) => {
  const { title, sections } = content[kind]
  return html`<!doctype html>
    <html lang="ja">
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${title}（仮） - slide</title>
      <style>
        body {
          font: 16px system-ui;
          max-width: 720px;
          margin: 6vh auto;
          padding: 0 16px;
          color: #152439;
          background: #f4f6fa;
        }
        .draft {
          padding: 12px 16px;
          border: 2px solid #b26a00;
          background: #fff6e5;
        }
      </style>
      <h1>${title}（仮）</h1>
      <p class="draft" role="note">
        <strong>このページは仮のものです。</strong>
        正式な内容はまだ決めていません。ここに書いたことは、約束や合意として扱いません。
        ${
          kind === 'contact'
            ? '問い合わせの受付は準備中です。'
            : '正式な内容を決めたら、このページを差し替えます。'
        }
      </p>
      <h2>載せる予定の内容</h2>
      <ul>
        ${sections.map((section) => html`<li>${section}</li>`)}
      </ul>
      <p><a href="/">トップページへ</a></p>
      ${raw(siteFooter)}
    </html>`
}
