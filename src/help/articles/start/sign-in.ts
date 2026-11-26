import { html } from 'hono/html'
import { defineArticle } from '../../article'
import { SERVICE_NAME } from '../../../site/service'

export default defineArticle({
  order: 10,
  form: 'howto',
  related: [
    'start/code-not-arrived',
    'start/invitation-only',
    'account/change-email',
  ],
  ja: {
    title: 'ログインする',
    lead: () =>
      html`${SERVICE_NAME} のログインは、メールアドレスに送るコードだけです。`,
    body: (n) =>
      html`<p>
          パスワードは使いません。GitHub
          などほかのアカウントでのログインはありません。
        </p>

        <ol>
          <li>
            ヘッダーの「ログイン」を開き、メールアドレスを入れて「コードを送る」を押します。
          </li>
          <li>
            メールで届いた ${n.codeDigits}
            桁のコードを入れて「ログイン」を押します。
          </li>
          <li>
            初めてのときは、ハンドル(スライドの URL
            に入る名前)と表示名を決め、利用規約とプライバシーポリシーに同意して、「はじめる」を押します。ハンドルはあとから変えられません。決めるまで、ほかの画面へは進めません。同意しないときは、「登録せずに終了する」を押すと、入力したメールアドレスを削除します。
          </li>
        </ol>
        <p>
          ログインすると、見ていたページへ戻ります。トップでファイルを預けていたときは、受け取りに進みます。
        </p>`,
  },
  en: {
    title: 'Sign in',
    lead: () =>
      html`Signing in to ${SERVICE_NAME} is only by a code we email you.`,
    body: (n) =>
      html`<p>
          There is no password, and no sign-in with GitHub or another account.
        </p>

        <ol>
          <li>
            Open “Sign in” in the header, enter your email address and press
            “Send the code”.
          </li>
          <li>
            Enter the ${n.codeDigits}-digit code from the email and press “Sign
            in”.
          </li>
          <li>
            The first time, choose a handle (the name in the URL of your slides)
            and a display name, and agree to the Terms of Service and the
            Privacy Policy, then press “Get started”. The handle cannot be
            changed later, and you cannot go to other pages until you have
            chosen. If you do not agree, press “Leave without signing up” and
            the email address you entered is deleted.
          </li>
        </ol>
        <p>
          After signing in you return to the page you were on. If you had left a
          file on the top page, it is received.
        </p>`,
  },
})
