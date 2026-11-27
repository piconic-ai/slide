import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 40,
  form: 'reference',
  related: ['start/sign-in', 'start/code-not-arrived', 'safety/data-we-keep'],
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
          メールアドレスは、自分の「設定」の「アカウント」にだけ出ます。ほかの利用者には見えません。表示する場面は、運営の画面に出る場面も含めて、<a
            href="/help/safety/data-we-keep"
            >預かっている情報と、その守り方</a
          >の一覧にあります。
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
          “Account”. Other users cannot see it. The places where it is shown,
          including those on the operator’s screens, are listed in
          <a href="/help/safety/data-we-keep"
            >what we keep, and how we protect it</a
          >.
        </p>`,
  },
})
