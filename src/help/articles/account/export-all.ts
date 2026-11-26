import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 60,
  form: 'howto',
  related: [
    'account/export-slide',
    'agent/export-with-agent',
    'account/before-leaving',
  ],
  ja: {
    title: 'すべてのデータを書き出す',
    lead: () =>
      html`「設定」の「データを書き出す」で、アカウントの情報と、すべてのスライドを受け取れます。`,
    body: (n) =>
      html`<ol>
          <li>
            「設定」を開き、「アカウント」の下の「データを書き出す」へ進みます。
          </li>
          <li>
            「アカウント」の「アカウントの情報(JSON)」を押して受け取ります。プロフィール画像を置いているときは、「プロフィール画像」も出ます。
          </li>
          <li>
            「スライド」の一覧で、受け取りたいスライドのリンクを押します。1
            本につき 1
            行で、「公開中の版(zip)」「準備済みの版(zip)」「記事(Markdown)」「スライドの情報(JSON)」のうち、あるものが並びます。${n.exportSlidesPerPage}
            本を超えるときは、「次のページ」で続きを開きます。
          </li>
        </ol>
        <h2>アカウントの情報(JSON)に入るもの</h2>
        <ul>
          <li>プロフィールと、ログインに使うメールアドレス</li>
          <li>フォローしている人とコミュニティ</li>
          <li>ミュートしている人とブロックしている人</li>
          <li>管理しているコミュニティの設定</li>
          <li>つないでいる AI エージェントの名前と日時</li>
          <li>
            スライドの一覧。引用しているほかの人のスライドは、URL
            だけが入ります。
          </li>
        </ul>
        <p>
          フォロワーや、自分をブロックした人は入りません。ほかの人のメールアドレスも入りません。
        </p>
        <h2>知っておくこと</h2>
        <ul>
          <li>
            限定公開と非公開のスライドも、運営が非表示にしたスライド(「運営が非表示にしています」と出ます)も、一覧に並び、受け取れます。
          </li>
          <li>
            すべてを 1 つにまとめた zip
            は作りません。スライドごとに受け取ります。1 本の受け取り方は<a
              href="/help/account/export-slide"
              >スライドを zip で受け取る</a
            >を読んでください。
          </li>
          <li>
            AI エージェントに頼んで書き出すこともできます(<a
              href="/help/agent/export-with-agent"
              >AI エージェントに全部を書き出してもらう</a
            >)。
          </li>
          <li>
            利用を止められているアカウントでは、書き出しを使えません。お問い合わせください。
          </li>
        </ul>`,
  },
  en: {
    title: 'Export all your data',
    lead: () =>
      html`“Export your data” in “Settings” gives you your account information
      and all your slides.`,
    body: (n) =>
      html`<ol>
          <li>
            Open “Settings” and go to “Export your data”, under “Account”.
          </li>
          <li>
            Under “Account”, press “Account information (JSON)” to take it. If
            you have put up a profile picture, “Profile picture” is there too.
          </li>
          <li>
            In the “Slides” list, press the links of the slide you want. There
            is one row per slide, with whichever of “Published version (zip)”,
            “Prepared version (zip)”, “Article (Markdown)” and “Slide
            information (JSON)” it has. When you have more than
            ${n.exportSlidesPerPage} slides, “Next page” opens the rest.
          </li>
        </ol>
        <h2>What “Account information (JSON)” holds</h2>
        <ul>
          <li>Your profile and the email address you sign in with</li>
          <li>The people and communities you follow</li>
          <li>The people you muted and blocked</li>
          <li>The settings of the communities you run</li>
          <li>The names and dates of the AI agents you connected</li>
          <li>
            The list of your slides. For slides of other people that you cite,
            only the URL is kept.
          </li>
        </ul>
        <p>
          Your followers and the people who blocked you are not in it, and
          neither are other people’s email addresses.
        </p>
        <h2>Good to know</h2>
        <ul>
          <li>
            Unlisted and private slides are listed and can be taken, and so are
            slides the operator hid (they say “Hidden by the operator”).
          </li>
          <li>
            There is no single zip of everything; you take the slides one by
            one. For one slide, read
            <a href="/help/account/export-slide">Take a slide out as a zip</a>.
          </li>
          <li>
            You can also ask an AI agent to write it all out (<a
              href="/help/agent/export-with-agent"
              >Ask an AI agent to write everything out</a
            >).
          </li>
          <li>
            An account that is suspended cannot use the export. Please contact
            us.
          </li>
        </ul>`,
  },
})
