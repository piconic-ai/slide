import { html } from 'hono/html'
import { defineArticle } from '../../article'
import { SERVICE_NAME } from '../../../site/service'

export default defineArticle({
  order: 10,
  form: 'reference',
  related: ['community/see-citations', 'articles/embed-page'],
  ja: {
    title: 'ほかのスライドを引用する',
    lead: () =>
      html`スライドの中に、ほかのスライドの共有
      URL(ページ番号つきでもかまいません)へのリンクを書くと、2
      つのスライドがつながります。`,
    body: (n) =>
      html`<p>作者に、申請や入力は要りません。</p>

        <ul>
          <li>
            リンクは、${SERVICE_NAME} のアドレスで始まる共有 URL (<code
              >https://…/@ハンドル/URL の名前</code
            >)を <code>href</code>
            に書いたものです。相対 URL、ほかのサイトの URL、プロフィールの URL
            は、引用になりません。
          </li>
          <li>
            リンクは、スライドを置いて確定するときに読みます。HTML
            ファイルごとに、先頭の ${n.linkScanKb} KB までです。画像を埋め込んだ
            1
            ファイルのスライドでは、後ろのほうのリンクは読まれないことがあります。
          </li>
          <li>
            同じスライドへのリンクは、引用になりません。同じ作者の別のスライドへのリンクは、引用になります。何ページで引用しても、1
            回だけ数えます。
          </li>
          <li>
            記事の中の共有 URL へのリンクも、引用になります(<a
              href="/help/articles/embed-page"
              >記事にスライドのページを入れる</a
            >を読んでください)。数えるのは、記事が公開中の間だけです。
          </li>
        </ul>`,
  },
  en: {
    title: 'Cite other slides',
    lead: () =>
      html`When your slides contain a link to the share link of other slides (a
      page number is fine), the two are connected.`,
    body: (n) =>
      html`<p>The author does not apply or type anything.</p>

        <ul>
          <li>
            The link is a share link that starts with ${SERVICE_NAME}’s own
            address (<code>https://…/@handle/name</code>), written in an
            <code>href</code>. A relative URL, the URL of another site or a
            profile URL is not a citation.
          </li>
          <li>
            The links are read when the slides are put up and the version is
            confirmed. For each HTML file, the first ${n.linkScanKb} KB are
            read. In a one-file slide with embedded images, a link near the end
            may not be read.
          </li>
          <li>
            A link to the same slides is not a citation. A link to another slide
            by the same author is. However many pages cite them, they are
            counted once.
          </li>
          <li>
            A link to a share link in an article is a citation too (see
            <a href="/help/articles/embed-page"
              >Put a page of slides in an article</a
            >). It counts only while the article is published.
          </li>
        </ul>`,
  },
})
