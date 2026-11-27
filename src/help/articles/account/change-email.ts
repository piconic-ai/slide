import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 40,
  form: 'reference',
  related: ['start/sign-in', 'start/code-not-arrived'],
  ja: {
    title: 'メールアドレスを変える、受信箱を失ったとき',
    lead: () => html`メールアドレスを変える画面はありません。`,
    body: () =>
      html`<p>
          アドレスを変えたいとき、受信箱に入れなくなったときは、<a
            href="/contact"
            >お問い合わせ</a
          >からご連絡ください。個別に対応します。
        </p>
        <p>
          メールアドレスは、自分の「設定」の「アカウント」にだけ出ます。ほかの利用者には見えません(運営は、招待の一覧で、招待したアドレスを読みます)。
        </p>`,
  },
  en: {
    title: 'Change your email address, or lose your inbox',
    lead: () => html`There is no screen to change the email address.`,
    body: () =>
      html`<p>
          If you want to change it, or can no longer open your inbox, please
          <a href="/contact">contact us</a>. We handle each case individually.
        </p>
        <p>
          Your email address is shown only on your own “Settings”, under
          “Account”. Other users cannot see it (the operator reads the addresses
          it invited, in its invitation list).
        </p>`,
  },
})
