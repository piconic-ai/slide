import { html } from 'hono/html'
import { defineArticle } from '../../article'
import { SERVICE_NAME } from '../../../site/service'

export default defineArticle({
  order: 30,
  form: 'howto',
  related: ['sharing/page-url', 'safety/external-access'],
  ja: {
    title: 'ブログにスライドを埋め込む',
    lead: () =>
      html`公開中のスライドは、ブログの記事の中でめくれる形で埋め込めます。`,
    body: () =>
      html`<h2>貼りかた</h2>

        <ol>
          <li>
            スライドの viewer
            の「共有」から「埋め込みコードをコピー」を押します。埋め込みコードは、viewer
            の「共有」からだけ取れます。
          </li>
          <li>
            コードをブログの記事に貼ります。コードは
            <code>&lt;iframe&gt;</code>
            1 つを包む箱で、記事の幅いっぱいにスライドが 16:9
            で映り、その下に題名とリンクの行が付きます。
          </li>
          <li>
            開始のページを変えたいときは、<code>src</code> の末尾に
            <code>/3</code> のようにページ番号を足します。
          </li>
        </ol>
        <p>
          一般公開されていないスライドの共有メニューには、埋め込みコードは出ません。公開を止めたスライドや、運営が非表示にしたスライドの埋め込みは、表示されなくなります。ブログサービスが
          <code>&lt;iframe&gt;</code>
          を貼れるかどうかは、そのサービスの決まりによります。
        </p>
        <h2>伝わること</h2>

        <ul>
          <li>
            埋め込み先のサイトには、記事を開いたことが伝わります(そのサイト自身のページなので)。枠の中は別の
            origin なので、スライドの中身、めくったページ、読者が
            ${SERVICE_NAME} にログインしているかどうかは、読めません。
          </li>
          <li>
            ${SERVICE_NAME} には、読者の IP
            アドレス、ブラウザの種類、埋め込みが読み込まれたことが伝わります。ブラウザの既定では、埋め込み先のサイトの
            origin(path は含みません)も届きます。読まれた回数は数えていません。
          </li>
          <li>
            スライドが外部のサービスへ通信する作りなら、そのサービスにも IP
            アドレスと開いたことが伝わります。<a
              href="/help/safety/external-access"
              >知らない人のスライドを安全に開く</a
            >を読んでください。
          </li>
        </ul>
        <h2>できないこと</h2>

        <ul>
          <li>
            埋め込みの中では、フォロー、通報、ミュートができません。下端の「${SERVICE_NAME}
            で開く」から viewer を開いて行います。
          </li>
          <li>
            埋め込みの中のスライドは、そのスライド自身のファイルへのリンクのほかは開きません。ほかのスライドの共有
            URL や、ほかのサイトへのリンクは、「${SERVICE_NAME} で開く」から
            viewer を開いてたどります。
          </li>
          <li>
            めくったページは、埋め込み先に伝わりません。「${SERVICE_NAME}
            で開く」の行き先は、埋め込みの URL のページ番号で決まります。
          </li>
          <li>viewer 本体の URL は、ほかのサイトに埋め込めません。</li>
        </ul>
        <h2>安全</h2>

        <p>
          埋め込みの中のスライドは、viewer
          と同じ囲いの中で動き、埋め込み先のページを移動させたり、別のタブを開いたり、フォームを送ったり、ファイルをダウンロードさせたりできません。埋め込みのページは、読者のログイン情報を読みません。
        </p>`,
  },
  en: {
    title: 'Embed slides in a blog',
    lead: () =>
      html`Public slides can be embedded so that readers can flip through them
      inside a blog post.`,
    body: (n) =>
      html`<h2>How to paste</h2>

        <ol>
          <li>
            In the viewer, press “Share” and then “Copy embed code”. The embed
            code comes from the viewer’s “Share” menu only.
          </li>
          <li>
            Paste the code into the blog post. It is one
            <code>&lt;iframe&gt;</code> in a box: the slides fill the width of
            the post at 16:9, with a line for the title and the link under them.
          </li>
          <li>
            To start at another page, add the page number to the end of
            <code>src</code>, like <code>/3</code>.
          </li>
        </ol>
        <p>
          The share menu of slides that are not public has no embed code. The
          embed of slides you stopped publishing, or that the operators hid,
          stops showing. Whether a blog service accepts an
          <code>&lt;iframe&gt;</code> is up to that service.
        </p>
        <h2>What is passed on</h2>

        <ul>
          <li>
            The embedding site learns that the post was opened (it is that
            site’s own page). The frame is another origin, so it cannot read the
            slides’ content, the page turned to, or whether the reader is signed
            in to ${SERVICE_NAME}.
          </li>
          <li>
            ${SERVICE_NAME} learns the reader’s IP address, their browser and
            that the embed was loaded. By the browser’s default, the origin of
            the embedding site (without its path) arrives too. Views are not
            counted.
          </li>
          <li>
            If the slides talk to other services, those services learn the IP
            address and that the slides were opened. Read
            <a href="/help/safety/external-access"
              >Open slides from someone you do not know safely</a
            >.
          </li>
        </ul>
        <h2>What it cannot do</h2>

        <ul>
          <li>
            Following, reporting and muting are not possible inside an embed.
            Use “Open on ${SERVICE_NAME}” at the bottom to open the viewer and
            do them there.
          </li>
          <li>
            Inside the embed, the slides open only links to their own files. A
            link to another slide’s share link, or to another site, is followed
            from the viewer you open with “Open on ${SERVICE_NAME}”.
          </li>
          <li>
            The page turned to is not passed to the embedding site. Where “Open
            on ${SERVICE_NAME}” goes is set by the page number in the embed’s
            URL.
          </li>
          <li>The viewer itself cannot be embedded in another site.</li>
        </ul>
        <h2>Safety</h2>

        <p>
          Slides inside an embed run in the same enclosure as in the viewer.
          They cannot move the embedding page, open another tab, send a form or
          start a download. The embed page does not read the reader’s sign-in.
        </p>`,
  },
})
