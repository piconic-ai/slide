import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 20,
  form: 'reference',
  related: ['sharing/page-url'],
  ja: {
    title: 'ページ番号の決まりを知る',
    lead: (n) =>
      html`スライドが開くのは、1 から ${n.viewerPage} までの番号です。`,
    body: (n) =>
      html`<ul>
          <li>
            スライドが開くのは 1 から ${n.viewerPage} までの番号です。<code
              >0</code
            >
            や ${n.viewerPage + 1} 以上、数字でない番号の URL
            は、見つからないページになります。<code>03</code> のように先頭に 0
            を付けた番号は、正しい表記(<code>3</code>)へ移ります。
          </li>
          <li>
            カードにページの画像が出るのは、1 から ${n.shotPage}
            までです。それより大きい番号と、撮影に失敗したときは、表紙が出ます。1
            ページ目の URL(番号なし)も、表紙です。
          </li>
        </ul>
        <p>
          SNS が一度取得したカードの画像をいつ更新するかは、SNS
          が決めます。スライドを直したあとも、古い画像がしばらく残ることがあります。
        </p>
        <h2>ツールごとの制限</h2>
        <ul>
          <li>
            Slidev
            のスライドは、めくったあとにブラウザの戻る・進むの操作をすると、見つからないページ(404)になることがあります。Chromium
            で起きることを確かめました。Firefox では起きませんでした。WebKit
            は未確認です。ページを開く、めくる、URL
            を共有することは、影響を受けません。
          </li>
          <li>
            reveal.js を ES module で読み込む出力(<code>import Reveal</code>
            で読み込み、グローバルの <code>Reveal</code>
            がないもの)は、ページ番号つきの URL を読み替えません。番号が 1
            つずれたページが開くことがあります。
          </li>
        </ul>`,
  },
  en: {
    title: 'Know the rules of page numbers',
    lead: (n) => html`Slides open at page numbers from 1 to ${n.viewerPage}.`,
    body: (n) =>
      html`<ul>
          <li>
            The slides open at numbers from 1 to ${n.viewerPage}. A link with
            <code>0</code>, ${n.viewerPage + 1} or more, or a number that is not
            digits is a page that is not found. A number with a leading zero
            such as <code>03</code> moves to the right spelling
            (<code>3</code>).
          </li>
          <li>
            The card shows the page image from 1 to ${n.shotPage}. A larger
            number, or a failed capture, shows the cover. The link of the first
            page without a number shows the cover too.
          </li>
        </ul>
        <p>
          When a social service refreshes a card image it has already taken is
          up to that service. After you fix the slides, the old image may stay
          for a while.
        </p>
        <h2>Limits by tool</h2>
        <ul>
          <li>
            With Slidev slides, using the browser's Back and Forward after
            turning pages can show a page that is not found (404). This was seen
            in Chromium and not in Firefox; WebKit has not been checked. Opening
            a page, turning pages and sharing the URL are not affected.
          </li>
          <li>
            Output that loads reveal.js as an ES module (with
            <code>import Reveal</code>, so no global <code>Reveal</code>) does
            not have its page-numbered URLs read as reveal.js does. The page
            that opens can be one off.
          </li>
        </ul>`,
  },
})
