import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 15,
  form: 'howto',
  related: ['start/sign-in', 'start/code-not-arrived', 'slides/daily-limit'],
  ja: {
    title: '登録する',
    lead: (n) =>
      n.invitationOnly
        ? html`登録できるのは運営が登録したメールアドレスの人だけで、メールに届くコードでログインし、ハンドルと表示名を決めて、はじめます。`
        : html`メールアドレスを持つ人は、メールに届くコードでログインし、ハンドルと表示名を決めると、登録できます。`,
    body: (n) =>
      html`<ol>
          <li>
            ヘッダーの「ログイン」を開き、メールアドレスを入れて「コードを送る」を押します。
          </li>
          <li>
            メールで届いた ${n.codeDigits}
            桁のコードを入れて「ログイン」を押します。
          </li>
          <li>
            初めてのときは、ハンドル(スライドの URL
            に入る名前)と表示名を決めます。
          </li>
          <li>
            <a href="/terms">利用規約</a>と<a href="/privacy"
              >プライバシーポリシー</a
            >に同意して、「はじめる」を押します。
          </li>
        </ol>
        <h2>知っておくこと</h2>
        <ul>
          <li>
            ハンドルは、自分ではあとから変えられません。変える必要があるときは、運営に頼めます(<a
              href="/help/community/ask-us"
              >ハンドルの変更などを運営に頼む</a
            >)。決めるまで、ほかの画面へは進めません。
          </li>
          <li>
            登録から ${n.newAuthorDays}
            日のあいだは、新しく置き始められるスライドは、直近
            ${n.newAuthorWindowHours} 時間に ${n.newAuthorPerDay} 本までです(<a
              href="/help/slides/daily-limit"
              >「今日はこれ以上置けません」と出たとき</a
            >)。
          </li>
          <li>
            同意しないときは、「登録せずに終了する」を押すと、入力したメールアドレスを削除します。
          </li>
          <li>
            パスワードは使いません。2 回目からは、手順 1 と 2
            だけでログインします(<a href="/help/start/sign-in">ログインする</a
            >)。
          </li>
        </ul>
        <h2>うまくいかないとき</h2>
        <ul>
          ${
            n.invitationOnly
              ? html`<li>
                  運営が登録していないメールアドレスには、コードが届きません。
                </li>`
              : ''
          }
          <li>
            「新しい登録を一時的に止めています。」と出たときは、運営が新しい登録を止めています。登録済みの人は、これまでどおりログインできます。しばらくしてから、もう一度お試しください。
          </li>
          <li>
            「ログインのコードの送信が集中しています。しばらくしてからやり直してください。」と出たときは、しばらくしてからやり直してください。
          </li>
          <li>
            コードが届かないときは、<a href="/help/start/code-not-arrived"
              >ログインのコードが届かないとき</a
            >を読んでください。
          </li>
        </ul>`,
  },
  en: {
    title: 'Sign up',
    lead: (n) =>
      n.invitationOnly
        ? html`Only people whose email address the operators registered can sign
          up: sign in with the code sent by email, choose a handle and a display
          name, and start.`
        : html`Anyone with an email address can sign up: sign in with the code
          sent by email, then choose a handle and a display name.`,
    body: (n) =>
      html`<ol>
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
            and a display name.
          </li>
          <li>
            Agree to the <a href="/terms">Terms of Service</a> and the
            <a href="/privacy">Privacy Policy</a>, and press “Get started”.
          </li>
        </ol>
        <h2>Good to know</h2>
        <ul>
          <li>
            You cannot change the handle yourself later, but you can ask the
            operator to (<a href="/help/community/ask-us"
              >Ask us to change a handle and more</a
            >). You cannot go to other pages until you have chosen.
          </li>
          <li>
            For the first ${n.newAuthorDays} days after you register, you can
            start up to ${n.newAuthorPerDay} new slides in any
            ${n.newAuthorWindowHours} hours (<a href="/help/slides/daily-limit"
              >When it says “You can’t put up any more today”</a
            >).
          </li>
          <li>
            If you do not agree, press “Leave without signing up” and the email
            address you entered is deleted.
          </li>
          <li>
            There is no password. From the second time you only need steps 1 and
            2 (<a href="/help/start/sign-in">Sign in</a>).
          </li>
        </ul>
        <h2>When it does not work</h2>
        <ul>
          ${
            n.invitationOnly
              ? html`<li>
                  An address the operators have not registered gets no code.
                </li>`
              : ''
          }
          <li>
            “New sign-ups are paused for now.” means the operator has stopped
            new sign-ups. If you have already signed up, you can sign in as
            usual. Try again in a while.
          </li>
          <li>
            “Too many sign-in codes are being sent right now. Please try again
            in a while.” means just that: try again in a while.
          </li>
          <li>
            If the code does not arrive, read
            <a href="/help/start/code-not-arrived"
              >When the sign-in code does not arrive</a
            >.
          </li>
        </ul>`,
  },
})
