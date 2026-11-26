import { html } from 'hono/html'
import { defineArticle } from '../../article'
import { SERVICE_NAME } from '../../../site/service'

export default defineArticle({
  order: 10,
  form: 'reference',
  related: ['sharing/page-numbers', 'sharing/embed-in-blog'],
  ja: {
    title: 'ページを指す URL を共有する',
    lead: () =>
      html`スライドの中の特定のページを共有したいときは、共有 URL
        の末尾にページ番号を付けます (<code>/@ハンドル/URL の名前/6</code>)。`,
    body: () =>
      html`<p>
          この URL を開くと、そのページからスライドが始まります。viewer
          の「共有」から「いま見ているページの URL
          をコピー」を押すと、いま見ているページの URL が取れます。
        </p>
        <p>
          X や Bluesky、チャットなどが URL のカードを作るとき、ページ番号つきの
          URL
          には、表紙ではなく、そのページを撮った画像が出ます。画像は、必要になったときに
          ${SERVICE_NAME} が撮るので、作者は何もしなくてかまいません。
        </p>
        <h2>働く条件</h2>

        <ul>
          <li>
            スライドが、ページ番号を <code>#6</code> の形(URL の
            <code>#</code> のあとに番号)で持っていること。Marp
            で作ったスライドなどが当てはまります。
          </li>
        </ul>
        <p>
          ページを伝える script を、作者が書く必要はありません。${SERVICE_NAME}
          が、スライドを配るときに、その版の
          <code>index.html</code>
          に入れます。スライドが自分の CSP(<code
            >&lt;meta http-equiv="Content-Security-Policy"&gt;</code
          >)を持っていても、その script
          だけが動くように調整し、ほかの許可は広げません。
        </p>
        <p>
          ページ番号が伝わらないスライドでは、「いま見ているページの URL
          をコピー」は出ません。
        </p>`,
  },
  en: {
    title: 'Share a link to one page',
    lead: () =>
      html`To share one page of the slides, add its number to the end of the
      share link (<code>/@handle/name/6</code>).`,
    body: (n) =>
      html`<p>
          Opening it starts the slides at that page. In the viewer, press
          “Share” and then “Copy link to this page” to get the link of the page
          you are looking at.
        </p>
        <p>
          When X, Bluesky or a chat app makes a card for the link, a link with a
          page number shows an image of that page instead of the cover.
          ${SERVICE_NAME} takes the image when it is needed, so the author does
          nothing.
        </p>
        <h2>When it works</h2>

        <ul>
          <li>
            The slides keep the page number in the form <code>#6</code> (the
            number after the <code>#</code> of the URL). Slides made with Marp
            are an example.
          </li>
        </ul>
        <p>
          The author does not need to write the script that reports the page.
          ${SERVICE_NAME} puts it into the <code>index.html</code> of the
          version as it serves the slides. When the slides declare their own CSP
          (<code>&lt;meta http-equiv="Content-Security-Policy"&gt;</code>),
          ${SERVICE_NAME} lets that one script run and allows nothing more.
        </p>
        <p>
          For slides whose page is not reported, “Copy link to this page” is not
          shown.
        </p>`,
  },
})
