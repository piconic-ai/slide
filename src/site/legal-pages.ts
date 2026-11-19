import { html } from 'hono/html'
import { messages, type Lang } from './i18n'
import { pageShell, PLAIN_PAGE_POLICY } from './shell'

/** Legal pages carry only service markup and the shared frame. */
export const LEGAL_PAGE_POLICY = PLAIN_PAGE_POLICY

/** Where inquiries are sent. Mail to it is forwarded to the operators (F17-AC24). */
export const CONTACT_ADDRESS = 'contact@slide.community'

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
    '取得する情報（GitHub のアカウント情報、GitHub の公開プロフィールから写す名前・ユーザー名・画像の URL・場所・Web サイト・GitHub Sponsors の有無、送られた資料、アクセスの記録）',
    '利用の目的（写したプロフィールは、作者のプロフィールページで公開します）',
    '保存の期間と、退会したときの削除（写したプロフィールも退会のときに消します）',
    '利用する外部のサービス（Cloudflare、GitHub）と、やり取りする情報（作者の画像は GitHub から直接読み込むため、プロフィールを開いた人の IP アドレスが GitHub に届きます。スライドは作者が決めた外部の相手と通信でき、その相手にはスライドを開いた人の IP アドレスが届きます）',
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
    contactLead: 'お問い合わせは、次のメールアドレスへお送りください。',
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
    contactLead: 'Please send inquiries to this email address.',
    replaced: 'This page will be replaced once the final text is decided.',
    planned: 'Planned contents (in Japanese only)',
    top: 'Go to the top page',
  },
})

export const legalPath = (kind: LegalKind) => `/${kind}`

export const legalPage = (kind: LegalKind, lang: Lang, url: URL) => {
  const t = text[lang]
  const title = t.draft(t.titles[kind])
  return pageShell({
    lang,
    title,
    url,
    width: 'reading',
    head: html`<style>
      .address {
        font-family: var(--font-mono);
        user-select: all;
      }
    </style>`,
    body: html`<h1>${title}</h1>
      <p class="notice-warning" role="note">
        <strong>${t.notice}</strong>
        ${t.notBinding} ${t.replaced}
      </p>
      ${
        kind === 'contact'
          ? html`<p>${t.contactLead}</p>
              <p class="address">
                <a href="mailto:${CONTACT_ADDRESS}">${CONTACT_ADDRESS}</a>
              </p>`
          : ''
      }
      <h2>${t.planned}</h2>
      <ul lang="ja">
        ${sections[kind].map((section) => html`<li>${section}</li>`)}
      </ul>`,
  })
}
