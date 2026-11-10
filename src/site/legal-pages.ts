import { html } from 'hono/html'
import { siteFooter } from './footer'
import { messages, type Lang } from './i18n'
import { SERVICE_NAME } from './service'

/** Legal pages carry only service markup, so they allow nothing else. */
export const LEGAL_PAGE_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

export const legalKinds = ['terms', 'privacy', 'contact'] as const
export type LegalKind = (typeof legalKinds)[number]

/**
 * What each final page will cover, until its text is decided. The text is
 * written in Japanese only (issue #65), so every screen language shows it.
 */
const sections: Readonly<Record<LegalKind, readonly string[]>> = {
  terms: [
    'サービスの内容と、利用できる人',
    'アカウントと、作者が送る資料の扱い',
    '禁止事項と、不正な資料への対応',
    'サービスの変更・停止と、免責',
    '規約の変更',
  ],
  privacy: [
    '取得する情報（GitHub のアカウント情報、送られた資料、アクセスの記録）',
    '利用の目的',
    '保存の期間と、退会したときの削除',
    '利用する外部のサービス（Cloudflare、GitHub）と、やり取りする情報',
    'お問い合わせ',
  ],
  contact: [
    'サービスについての質問',
    '不正な資料の通報',
    '個人情報の扱いについての請求',
  ],
}

// Placeholders only: the wording is decided by a person before launch.
const text = messages({
  ja: {
    titles: {
      terms: '利用規約',
      privacy: 'プライバシーポリシー',
      contact: 'お問い合わせ',
    },
    draft: (title: string) => `${title}（仮）`,
    notice: 'このページは仮のものです。',
    notBinding:
      '正式な内容はまだ決めていません。ここに書いたことは、約束や合意として扱いません。',
    contactPending: '問い合わせの受付は準備中です。',
    replaced: '正式な内容を決めたら、このページを差し替えます。',
    planned: '載せる予定の内容',
    top: 'トップページへ',
  },
  en: {
    titles: {
      terms: 'Terms of Service',
      privacy: 'Privacy Policy',
      contact: 'Contact',
    },
    draft: (title: string) => `${title} (draft)`,
    notice: 'This page is a placeholder.',
    notBinding:
      'The final text has not been decided yet. Nothing written here is a promise or an agreement.',
    contactPending: 'We are not taking inquiries yet.',
    replaced: 'This page will be replaced once the final text is decided.',
    planned: 'Planned contents (in Japanese only)',
    top: 'Go to the top page',
  },
})

export const legalPath = (kind: LegalKind) => `/${kind}`

export const legalPage = (kind: LegalKind, lang: Lang, url: URL) => {
  const t = text[lang]
  const title = t.draft(t.titles[kind])
  return html`<!doctype html>
    <html lang="${lang}">
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${title} - ${SERVICE_NAME}</title>
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
      <h1>${title}</h1>
      <p class="draft" role="note">
        <strong>${t.notice}</strong>
        ${t.notBinding} ${kind === 'contact' ? t.contactPending : t.replaced}
      </p>
      <h2>${t.planned}</h2>
      <ul lang="ja">
        ${sections[kind].map((section) => html`<li>${section}</li>`)}
      </ul>
      <p><a href="/">${t.top}</a></p>
      ${siteFooter(lang, url)}
    </html>`
}
