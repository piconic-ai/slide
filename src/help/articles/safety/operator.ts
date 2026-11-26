import { html } from 'hono/html'
import { defineArticle } from '../../article'
import { legalHref, PRIVACY_REQUESTS } from '../../legal-links'

export default defineArticle({
  order: 100,
  form: 'reference',
  related: ['safety/appeal', 'safety/data-we-keep', 'safety/terms'],
  ja: {
    title: '運営者と連絡先',
    lead: () =>
      html`運営者の名前は、利用規約とプライバシーポリシーの冒頭に書いてあり、連絡は、「お問い合わせ」のページに示す方法で受け付けます。`,
    body: () =>
      html`<h2>運営者</h2>
        <p>
          運営者の名前は、<a href="/terms">利用規約</a>と<a href="/privacy"
            >プライバシーポリシー</a
          >の冒頭に書いてあります。
        </p>
        <h2>連絡先</h2>
        <p>
          ページの下の「お問い合わせ」を開くと、連絡を受け付けるメールアドレスが出ています。利用規約も、運営者への連絡は、お問い合わせのページに示す方法で行うと定めています。
        </p>
        <h2>連絡するとき</h2>
        <ul>
          <li>
            使い方で困ったとき:
            まず、ヘルプの記事を探してください。見つからないときや、解決しないときに、連絡してください。
          </li>
          <li>
            非表示や利用の停止に納得できないとき:
            <a href="/help/safety/appeal"
              >非表示や利用の停止に異議を申し立てる</a
            >を読んでください。
          </li>
          <li>
            個人情報の開示、訂正、利用の停止、削除などを求めるとき:
            設定でできないものは、お問い合わせの窓口に求めます。プライバシーポリシーの<a
              href="${legalHref('privacy', PRIVACY_REQUESTS)}"
              >「${PRIVACY_REQUESTS}」</a
            >を読んでください。
          </li>
        </ul>`,
  },
  en: {
    title: 'The operator and how to reach them',
    lead: () =>
      html`The operator’s name is written at the start of the Terms of Service
      and the Privacy Policy, and you reach them in the way the “Contact” page
      gives.`,
    body: () =>
      html`<h2>The operator</h2>
        <p>
          The operator’s name is written at the start of the
          <a href="/terms">Terms of Service</a> and the
          <a href="/privacy">Privacy Policy</a>, which are in Japanese only.
        </p>
        <h2>How to reach them</h2>
        <p>
          “Contact” at the bottom of the page shows the email address that
          receives your message. The Terms of Service also say you reach the
          operator in the way the contact page gives.
        </p>
        <h2>When to write</h2>
        <ul>
          <li>
            You are stuck with how something works: look for an article in the
            Help first. Write when you do not find one, or it does not solve it.
          </li>
          <li>
            You do not agree with a hiding or a suspension: read
            <a href="/help/safety/appeal">Appeal a hiding or a suspension</a>.
          </li>
          <li>
            You want to ask for disclosure, correction, stopping the use or
            deletion of your personal information: what the settings cannot do,
            you ask the contact for. Read the article of the Privacy Policy on
            such requests (<a href="${legalHref('privacy', PRIVACY_REQUESTS)}"
              >Privacy Policy</a
            >).
          </li>
        </ul>`,
  },
})
