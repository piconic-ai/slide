import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 50,
  form: 'howto',
  related: ['agent/reconnect', 'account/export-all', 'agent/connect'],
  ja: {
    title: 'AI エージェントに全部を書き出してもらう',
    lead: () =>
      html`つないである AI
      エージェントに頼むと、すべてのスライドと記事とアカウントの情報を、会話のまま手元のフォルダに書き出してもらえます。`,
    body: (n) =>
      html`<p>
          先に、エージェントがつながっていて、接続の許可に「自分のスライドと記事を読み、取り出す」が含まれている必要があります。つなぎ方は<a
            href="/help/agent/connect"
            >AI エージェントをつなぐ</a
          >を読んでください。
        </p>
        <ol>
          <li>
            エージェントに、書き出す先のフォルダを決めて頼みます。たとえば「slide.community
            のスライドと記事と、アカウントの情報を、すべてこのフォルダに書き出して」と頼みます。
          </li>
          <li>
            エージェントは、<code>export_account</code>
            でアカウントの情報とスライドの一覧を受け取り、<code
              >account.json</code
            >
            に書きます。
          </li>
          <li>
            スライドごとに、<code>get_slide_files</code>
            でファイルの一覧を取り、ファイルを 1
            つずつ取り出して書きます。取り出したファイルが、置いたままであることは、SHA-256
            で確かめます。ファイルが多いスライドは、${n.agentFilesPerCall}
            個ずつ続きを取ります。
          </li>
          <li>
            <code>get_article_draft</code>
            で記事と関連リンクを取り、記事があるスライドの分を書きます。
          </li>
        </ol>
        <h2>手元に残るもの</h2>
        <ul>
          <li><code>account.json</code>(アカウントの情報)</li>
          <li>
            スライドごとのフォルダの中の、<code>published/…</code>(公開中の版のファイル)と、あれば<code>prepared/…</code>(準備済みの版のファイル)
          </li>
          <li>
            記事があるスライドの <code>article.md</code> と
            <code>links.json</code>(関連リンク)
          </li>
        </ul>
        <p>
          限定公開と非公開のスライドも含みます。zip
          にはならず、置いたままのファイルが 1 つずつ書かれます。zip
          で受け取りたいときは、<a href="/help/account/export-slide"
            >スライドを zip で受け取る</a
          >を読んでください。
        </p>
        <h2>うまくいかないとき</h2>
        <ul>
          <li>
            エージェントが、この接続は書き出しができるようになる前に作られたので、つなぎ直すように伝えてきたときは、接続をつなぎ直します(<a
              href="/help/agent/reconnect"
              >接続をつなぎ直す</a
            >)。
          </li>
          <li>
            ファイルを取り出す URL は、${n.fileUrlMinutes}
            分で使えなくなります。切れたときは、エージェントが
            <code>get_slide_files</code>
            をもう一度呼んで取り直します。あなたが URL
            を見たり、控えたりする必要はありません。
          </li>
          <li>
            エージェントが、ファイルを書き出せない版があると伝えたときは、その版だけが外れています。ほかの版と、ほかのスライドは書き出せます。
          </li>
          <li>
            利用を止められているアカウントでは、書き出せません。お問い合わせください。
          </li>
        </ul>`,
  },
  en: {
    title: 'Ask an AI agent to write everything out',
    lead: () =>
      html`Ask an AI agent you have connected, and it writes all your slides,
      articles and account information into a folder on your computer, as part
      of the conversation.`,
    body: (n) =>
      html`<p>
          First the agent must be connected, and its permission must include
          “Read your slides and articles, and take them out”. To connect one,
          read
          <a href="/help/agent/connect">Connect an AI agent</a>.
        </p>
        <ol>
          <li>
            Pick a folder to write into and ask the agent. For example: “Write
            all my slide.community slides, articles and account information into
            this folder.”
          </li>
          <li>
            The agent calls <code>export_account</code> to get your account
            information and the list of your slides, and writes
            <code>account.json</code>.
          </li>
          <li>
            For each slide it calls <code>get_slide_files</code> to list the
            files, then fetches and writes them one by one. It checks each file
            against its SHA-256 to be sure it is as you put it up. A slide with
            many files comes ${n.agentFilesPerCall} at a time.
          </li>
          <li>
            It calls <code>get_article_draft</code> for the article and the
            related links of each slide that has an article, and writes them.
          </li>
        </ol>
        <h2>What you end up with</h2>
        <ul>
          <li><code>account.json</code> (your account information)</li>
          <li>
            In a folder for each slide, <code>published/…</code> (the files of
            the public version) and, if there is one, <code>prepared/…</code>
            (the files of the prepared version)
          </li>
          <li>
            For each slide with an article, <code>article.md</code> and
            <code>links.json</code> (the related links)
          </li>
        </ul>
        <p>
          Unlisted and private slides are included. It is not a zip: the files
          are written one by one, as you put them up. If you want a zip, read
          <a href="/help/account/export-slide">Take a slide out as a zip</a>.
        </p>
        <h2>When it does not work</h2>
        <ul>
          <li>
            If the agent says this connection was made before slide.community
            could export data, connect it again (<a href="/help/agent/reconnect"
              >Connect an agent again</a
            >).
          </li>
          <li>
            The addresses the files are fetched from stop working after
            ${n.fileUrlMinutes} minutes. When they run out, the agent calls
            <code>get_slide_files</code> again for new ones. You do not need to
            see or keep them.
          </li>
          <li>
            If the agent says a version cannot be written out, only that version
            is left out. The other versions and the other slides can be written.
          </li>
          <li>
            An account that is suspended cannot export. Please contact us.
          </li>
        </ul>`,
  },
})
