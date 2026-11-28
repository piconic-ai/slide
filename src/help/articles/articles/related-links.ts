import { html } from 'hono/html'
import { defineArticle } from '../../article'
import { SERVICE_NAME } from '../../../site/service'

export default defineArticle({
  order: 50,
  form: 'howto',
  related: ['community/list-event-talks', 'community/cite-slides'],
  ja: {
    title: '関連リンクを足す',
    lead: () =>
      html`録画、ブログの記事など、外のページへのリンクを、スライドの題名の下に載せられます。`,
    body: (n) =>
      html`<h2>足しかた</h2>

        <ol>
          <li>スライドの編集の画面の「関連リンク」の枠を開きます。</li>
          <li>
            URL
            を入れ、題名は入れたいときだけ入れて、「追加する」を押します。種類は、URL
            から決まります。
          </li>
          <li>
            要らなくなったら、その行の「外す」を押します。並びは足した順で、並べ替えはできません。
          </li>
        </ol>
        <h2>決まり</h2>

        <ul>
          <li>
            種類は、動画、記事、イベント、その他の 4
            つです。connpass、Doorkeeper、Luma
            のイベントのページはイベント、YouTube や Vimeo などは動画、Zenn や
            Qiita
            などは記事、それ以外はその他になります。イベントのリンクのことは、<a
              href="/help/community/list-event-talks"
              >スライドをイベントの発表として並べる</a
            >を読んでください。
          </li>
          <li>1 本のスライドに、${n.maxLinks} 件までです。</li>
          <li>
            URL は <code>https://</code> で始まるものだけです。題名は
            ${n.linkTitleChars} 文字までで、入れなくてもかまいません。
          </li>
          <li>
            同じ URL を入れた作者が 2 人以上になると、<a
              href="/help/community/link-gathering"
              >その URL のリンクのページにスライドが並びます</a
            >。
          </li>
          <li>
            題名を入れなかったときは、サイト名(URL のホスト名。例:
            <code>zenn.dev</code>)だけを出します。リンク先は、${SERVICE_NAME}
            が取りに行きません(題名も取りません)。動画は埋め込まず、リンクだけです。
          </li>
        </ul>
        <p>
          読者には、スライドが一般公開されている間だけ見えます。作者は、作者だけが見られる間も
          viewer で確かめられます。関連リンクは、引用としては数えません。
        </p>`,
  },
  en: {
    title: 'Add related links',
    lead: () =>
      html`You can put links to other pages, such as a recording or a blog post,
      under the title of the slides.`,
    body: (n) =>
      html`<h2>How to add one</h2>

        <ol>
          <li>Open the “Related links” area on the edit page of the slides.</li>
          <li>
            Enter the URL, a title only if you want one, and press “Add”. The
            kind is read from the URL.
          </li>
          <li>
            When you no longer need one, press “Remove” on its row. They stay in
            the order you added them, and cannot be reordered.
          </li>
        </ol>
        <h2>The rules</h2>

        <ul>
          <li>
            The kinds are Video, Article, Event and Other. Event pages on
            connpass, Doorkeeper and Luma are events; YouTube and Vimeo are
            videos; Zenn and Qiita are articles; anything else is Other. For
            links to events, read
            <a href="/help/community/list-event-talks"
              >List your slides as talks at an event</a
            >.
          </li>
          <li>One slide can have up to ${n.maxLinks} links.</li>
          <li>
            The URL must start with <code>https://</code>. The title is
            optional, up to ${n.linkTitleChars} characters.
          </li>
          <li>
            Once two or more authors have entered the same URL,
            <a href="/help/community/link-gathering"
              >the slides are listed on that URL’s page of links</a
            >.
          </li>
          <li>
            Without a title, only the site name (the host name of the URL, e.g.
            <code>zenn.dev</code>) is shown. ${SERVICE_NAME} does not fetch the
            page, not even for its title. A video is not embedded; it is only a
            link.
          </li>
        </ul>
        <p>
          Readers see them only while the slides are public. You can check them
          in the viewer while the slides are visible only to you. Related links
          do not count as citations.
        </p>`,
  },
})
