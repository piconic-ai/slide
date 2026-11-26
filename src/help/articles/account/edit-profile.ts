import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 10,
  form: 'reference',
  related: ['account/profile-picture', 'account/email-privacy'],
  ja: {
    title: 'プロフィールを書く',
    lead: () =>
      html`プロフィールは、自分で「設定」の「プロフィール」に書きます。`,
    body: (n) =>
      html`<p>書いたものは、プロフィールのページに出ます。</p>
        <h2>書けること</h2>

        <ul>
          <li>表示名(必須。${n.nameChars} 文字まで)</li>
          <li>自己紹介(${n.bioChars} 文字まで)</li>
          <li>場所(${n.locationChars} 文字まで)</li>
          <li>Web サイト(1 つ)</li>
          <li>SNS のリンク(${n.profileLinks} つまで)</li>
        </ul>
        <p>
          リンクは <code>https://</code>
          で始まる URL
          だけ使えます。ハンドルは、はじめに決めたあと変えられません。
        </p>`,
  },
  en: {
    title: 'Write your profile',
    lead: () =>
      html`You write your profile yourself, in “Settings” under “Profile”.`,
    body: (n) =>
      html`<p>What you write is shown on your profile page.</p>
        <h2>What you can write</h2>

        <ul>
          <li>Display name (required; up to ${n.nameChars} characters)</li>
          <li>Bio (up to ${n.bioChars} characters)</li>
          <li>Location (up to ${n.locationChars} characters)</li>
          <li>A website (one)</li>
          <li>Social links (up to ${n.profileLinks})</li>
        </ul>
        <p>
          Links must be URLs that start with <code>https://</code>. The handle
          cannot be changed after you choose it at the start.
        </p>`,
  },
})
