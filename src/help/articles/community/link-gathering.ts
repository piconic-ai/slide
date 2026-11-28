import { html } from 'hono/html'
import { defineArticle } from '../../article'
import { SERVICE_NAME } from '../../../site/service'

export default defineArticle({
  order: 60,
  form: 'howto',
  related: [
    'articles/related-links',
    'community/list-event-talks',
    'community/link-rules',
  ],
  ja: {
    title: '同じリンクを添えたスライドを集めて見る',
    lead: () =>
      html`スライドの関連リンクに同じ URL を入れた人どうしのスライドは、その URL
      のリンクのページに並びます。`,
    body: () =>
      html`<h2>集まる条件</h2>

        <ul>
          <li>
            2 人以上の作者の、一般公開中のスライドが、同じ URL
            を関連リンクに持つと、その URL
            のリンクのページが出ます。同じ人のスライドだけでは、出ません。
          </li>
          <li>
            <a href="/help/community/list-event-talks">イベントの URL</a>と、<a
              href="/help/community/link-rules"
              >コミュニティに入ったリンク</a
            >は、一般公開中のスライドが 1 本でもあれば、出ます。
          </li>
          <li>
            並ぶのは、一般公開中のスライドだけで、一般公開の新しい順です。
          </li>
          <li>
            追跡用のクエリ、<code>www.</code>、末尾の <code>/</code>、YouTube
            の開始時刻(<code>t</code>)が違っても、同じ URL です。
          </li>
        </ul>
        <h2>開きかた</h2>

        <ol>
          <li>
            viewer
            の「関連リンク」の行の「このリンクを添えたスライド」を押します。ページが出ているリンクにだけ、出ます。
          </li>
          <li>
            URL から開くときは、その URL の前に
            <code>${SERVICE_NAME}/link/</code>
            を付けます(例:
            <code>${SERVICE_NAME}/link/https://example.com/post</code>)。<code
              >https://</code
            >
            を省いた URL に移ります。集まりの無い URL では、「この URL
            の集まりは、まだありません」と出ます。
          </li>
          <li>
            自分のスライドが並ぶページは、スライドの編集の画面の「このスライドが並ぶページ」の枠で確かめられます。コミュニティに入ったリンクは、コミュニティのページの「リンク」のタブにも並びます。
          </li>
        </ol>
        <h2>外したいとき</h2>

        <p>
          スライドの編集の画面の「関連リンク」で、そのリンクの「外す」を押します。スライドは、そのリンクのページから外れます。集まる条件を満たさなくなったページは、出なくなります。
        </p>
        <h2>ページの見出し</h2>

        <ul>
          <li>
            ${SERVICE_NAME}
            は、リンク先を取りに行きません。見出しは、一般公開中のスライドのそのリンクのうち、最初に保存された題名です。題名が
            1 つも無ければ、サイト名と URL(例:
            <code>example.com https://example.com/post</code>)です。
          </li>
          <li>
            見出しを後から直す画面は、ありません。直したいときは、<a
              href="/contact"
              >お問い合わせ</a
            >から運営に知らせてください。
          </li>
        </ul>`,
  },
  en: {
    title: 'See the slides that share a related link',
    lead: () =>
      html`Slides whose authors put the same URL into their related links are
      listed together on that URL’s page of links.`,
    body: () =>
      html`<h2>When slides gather</h2>

        <ul>
          <li>
            When public slides of two or more authors have the same URL in their
            related links, that URL’s page of links shows. The slides of one
            author alone do not make it show.
          </li>
          <li>
            <a href="/help/community/list-event-talks">An event’s URL</a> and
            <a href="/help/community/link-rules">a link a community holds</a>
            show a page with even one public slide.
          </li>
          <li>
            The page lists only public slides, the most recently made public
            first.
          </li>
          <li>
            The same URL, even with a different tracking query,
            <code>www.</code>, a trailing <code>/</code> or a start time on
            YouTube (<code>t</code>).
          </li>
        </ul>
        <h2>How to open the page</h2>

        <ol>
          <li>
            In the viewer, press “Slides with this link” on the row under
            “Related links”. It is there only on a link whose page shows.
          </li>
          <li>
            To open it from a URL, put <code>${SERVICE_NAME}/link/</code> before
            the URL (for example,
            <code>${SERVICE_NAME}/link/https://example.com/post</code>). You are
            moved to the URL without <code>https://</code>. Where no slides are
            gathered, the page says “Nothing is gathered at this URL yet”.
          </li>
          <li>
            The “Pages this slide appears on” area on the edit page shows the
            pages your slides are on. A link a community holds is also listed on
            the “Links” tab of the community’s page.
          </li>
        </ol>
        <h2>Taking slides off</h2>

        <p>
          Under “Related links” on the edit page, press “Remove” on the link.
          The slides leave the link’s page. A page that no longer meets the
          conditions above stops showing.
        </p>
        <h2>The page’s heading</h2>

        <ul>
          <li>
            ${SERVICE_NAME} does not fetch the linked page. The heading is the
            title saved first among that link on public slides. With no title at
            all, it is the site name and the URL (for example,
            <code>example.com https://example.com/post</code>).
          </li>
          <li>
            There is no screen to change the heading later. If it needs fixing,
            tell the service through <a href="/contact">Contact</a>.
          </li>
        </ul>`,
  },
})
