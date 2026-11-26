import { html } from 'hono/html'
import { defineArticle } from '../../article'
import { SERVICE_NAME } from '../../../site/service'

export default defineArticle({
  order: 10,
  form: 'howto',
  related: ['slides/accepted-files', 'slides/limits', 'slides/replace'],
  ja: {
    title: 'スライドを置く',
    lead: () =>
      html`トップか「スライドの管理」にファイルをドロップして置き、表示を確かめてから「公開する」を押します。`,
    body: (n) =>
      html`<p>
          ${SERVICE_NAME}
          は、いまは招待制です。運営が登録したメールアドレスの人だけが、ログインして、スライドを置けます。登録していない人には、ログインのコードが届かないので、ファイルを置けません(くわしくは<a
            href="/help/start/sign-in"
            >ログインする</a
          >を読んでください)。
        </p>

        <ol>
          <li>
            トップか「スライドの管理」に、ファイルをドロップします(「ファイルを選ぶ」からも選べます)。ログインしていないときは、ファイルをこのブラウザの中に預かります。このタブで「ログインして続ける」を押し、メールのコードでログインして、${n.continueMinutes}
            分以内に戻ると、自動で受け取ります。ヘッダーの「ログイン」からログインしたときや、${n.continueMinutes}
            分を過ぎたときは自動では受け取らないので、もう一度ファイルをドロップしてください。預かるのは
            1 件だけで、${n.stashHours}
            時間たつと捨てます。ログインした状態でトップを開くと、預かったファイルは捨てられます。
          </li>
          <li>
            受け取ったスライドは、作者だけが見られる状態で、スライドの編集の画面に開きます。題名は
            <code>index.html</code> の <code>&lt;title&gt;</code>、URL
            の名前は題名かファイル名から決めてあります。
          </li>
          <li>
            表示を確かめます。「公開する」を押すと、共有 URL (<code
              >/@ハンドル/URL の名前</code
            >)をだれでも開けるようになります。
          </li>
        </ol>
        <p>
          公開を止めるときは、同じページの「公開を止める」を押します。止めると、読者は開けなくなります。もう一度公開すると、同じ
          URL
          で開けます。止めたあと、新しい版を受け取っても、自動では公開し直しません。
        </p>`,
  },
  en: {
    title: 'Put up slides',
    lead: () =>
      html`Drop your files on the top page or on “Your slides”, check how they
      look, and press “Publish”.`,
    body: (n) =>
      html`<p>
          ${SERVICE_NAME} is invite-only for now. Only people whose email
          address the operators registered can sign in and put slides up.
          Someone who is not registered gets no sign-in code, so they cannot put
          slides up (see <a href="/help/start/sign-in">Sign in</a>).
        </p>

        <ol>
          <li>
            Drop the file on the top page or on “Your slides” (you can also
            choose it with “Choose a file”). If you are not signed in, the file
            is kept in this browser. If you press “Sign in to continue” in this
            tab, sign in with the emailed code and return within
            ${n.continueMinutes} minutes, it is received automatically. If you
            sign in from the header instead, or take longer, it is not received
            by itself, so drop the file again. Only one file is kept, and it is
            discarded after ${n.stashHours} hours. Opening the top page while
            signed in discards it too.
          </li>
          <li>
            The slides open on an edit page, visible only to you. The title
            comes from the <code>&lt;title&gt;</code> of
            <code>index.html</code>, and the name in the URL from the title or
            the file name.
          </li>
          <li>
            Check how they look. Press “Publish” and anyone can open the share
            link (<code>/@handle/name</code>).
          </li>
        </ol>
        <p>
          To stop publishing, press “Stop publishing” on the same page. Readers
          can no longer open the slides; publish again and they open at the same
          URL. A new version received afterwards does not publish again by
          itself.
        </p>`,
  },
})
