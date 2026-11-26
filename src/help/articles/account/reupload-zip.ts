import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 70,
  form: 'howto',
  related: ['account/export-slide', 'slides/accepted-files', 'slides/replace'],
  ja: {
    title: '書き出した zip を置き直す',
    lead: () =>
      html`受け取った zip
      は、展開せずにそのまま、トップか「スライドの管理」にドロップすると、同じファイルの版として置き直せます。`,
    body: () =>
      html`<ol>
          <li>
            受け取った zip
            を展開しないまま、トップか「スライドの管理」にドロップします(「ファイルを選ぶ」からも選べます)。
          </li>
          <li>
            受け取りが終わると、スライドの編集の画面が開きます。ファイルの中身は、書き出したときと同じです。
          </li>
          <li>表示を確かめて、「公開する」を押します。</li>
        </ol>
        <h2>知っておくこと</h2>
        <ul>
          <li>
            ドロップすると、新しいスライドとして置かれます。URL
            の名前は、題名かファイル名から決まります。変えたいときは、公開する前に、
            <a href="/help/slides/url-name">URL の名前を変える</a
            >を読んでください。
          </li>
          <li>
            いまあるスライドの新しい版にしたいときは、そのスライドの編集の画面の「新しい版」にドロップします(<a
              href="/help/slides/replace"
              >スライドを差し替える</a
            >)。
          </li>
          <li>
            「記事(Markdown)」と「スライドの情報(JSON)」は、zip
            には入っていないので、置き直しても戻りません。記事は、記事の編集の画面で書き直します。記事の中のページの埋め込みは、書いたときの共有
            URL のままです。
          </li>
        </ul>
        <h2>置けないとき</h2>
        <p>
          置けなかったときは、理由が枠の中に出ます。ファイルの形は<a
            href="/help/slides/accepted-files"
            >置けるファイルの形を確かめる</a
          >、上限は<a href="/help/slides/limits"
            >置ける大きさと本数の上限を知る</a
          >を読んでください。
        </p>`,
  },
  en: {
    title: 'Put up a zip you exported again',
    lead: () =>
      html`Drop the zip you took, without unpacking it, on the top page or on
      “Your slides”, and it is put up again as a version with the same files.`,
    body: () =>
      html`<ol>
          <li>
            Drop the zip on the top page or on “Your slides” without unpacking
            it (you can also choose it with “Choose a file”).
          </li>
          <li>
            When it is received, the slide’s edit page opens. The files are the
            same as when you took them out.
          </li>
          <li>Check how they look and press “Publish”.</li>
        </ol>
        <h2>Good to know</h2>
        <ul>
          <li>
            Dropping it puts up a new slide. The name in the URL comes from the
            title or the file name. To change it, read
            <a href="/help/slides/url-name">Change the name in the URL</a>
            before you publish.
          </li>
          <li>
            To make it a new version of a slide you already have, drop it on
            “New version” on that slide’s edit page (<a
              href="/help/slides/replace"
              >Replace slides</a
            >).
          </li>
          <li>
            “Article (Markdown)” and “Slide information (JSON)” are not in the
            zip, so they do not come back. Write the article again on its edit
            page. Page embeds in it keep the share URL they had when you wrote
            them.
          </li>
        </ul>
        <h2>When it cannot be put up</h2>
        <p>
          The reason shows inside the drop area. For the kinds of file, read
          <a href="/help/slides/accepted-files"
            >Check which files you can put up</a
          >; for the limits, read
          <a href="/help/slides/limits">Know the limits on size and number</a>.
        </p>`,
  },
})
