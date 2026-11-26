import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 30,
  form: 'reference',
  related: ['start/sign-in', 'account/change-email'],
  ja: {
    title: 'ログインのコードが届かないとき',
    lead: () =>
      html`迷惑メールフォルダを確かめ、メールアドレスの打ち間違いがないかを見てください。`,
    body: (n) =>
      html`<p>登録されていないアドレスにも、コードは届きません。</p>
        <h2>コード</h2>

        <ul>
          <li>コードの有効期限は ${n.codeMinutes} 分です。</li>
          <li>
            入力を ${n.codeAttempts}
            回間違えると、そのコードは使えなくなります。「コードを送り直す」で新しいコードを受け取ってください。
          </li>
          <li>
            コードを短い間に何度も頼むと、しばらく送れなくなります。画面に、いつ以降にもう一度頼めるかが出ます。
          </li>
        </ul>`,
  },
  en: {
    title: 'When the sign-in code does not arrive',
    lead: () => html`Check your spam folder and the spelling of the address.`,
    body: (n) =>
      html`<p>An address that is not registered gets no code either.</p>
        <h2>The code</h2>

        <ul>
          <li>A code works for ${n.codeMinutes} minutes.</li>
          <li>
            After ${n.codeAttempts} wrong tries the code stops working. Press
            “Send the code again” for a new one.
          </li>
          <li>
            If you ask for codes too often in a short time, none are sent for a
            while. The screen says when you can ask again.
          </li>
        </ul>`,
  },
})
