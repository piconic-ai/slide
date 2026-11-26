import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 30,
  form: 'reference',
  related: ['articles/write', 'community/cite-slides', 'sharing/page-url'],
  ja: {
    title: '記事にスライドのページを入れる',
    lead: () =>
      html`ページ番号つきの共有 URL(<code>https://…/@ハンドル/URL の名前/3</code
        >)を、段落の中でその URL だけで 1
        行に書くと、そのページの画像が入ります。`,
    body: (n) =>
      html`<p>
          自分のこのスライドのページは、いくつでも画像になります。ほかのスライドのページは、1
          本の記事で ${n.embedDecks} 本のスライドまで画像になり(1
          本のスライドのページは、いくつ書いても 1
          本と数えます)、書いた順でそれより後のスライドのページは、ふつうのリンクになります。
        </p>
        <ul>
          <li>
            自分のこのスライドのページなら、画像を押すと、上のスライドがそのページに移ります。
          </li>
          <li>
            ほかの人の一般公開中のスライドなら、「△△さんの『□□』3
            ページ」と画像が出て、押すとそのスライドのそのページが開きます。
          </li>
          <li>
            一般公開されていないスライド、存在しないスライドやページは、画像を出さず、ふつうのリンクになります。
          </li>
          <li>文の中に書いた URL は、ふつうのリンクになります。</li>
        </ul>
        <h2>引用として数えられます</h2>

        <p>
          記事の中の、ほかのスライドの共有 URL
          へのリンクは、スライドの中のリンクと同じく、引用として数えられます(<a
            href="/help/community/cite-slides"
            >ほかのスライドを引用する</a
          >を読んでください)。数えるのは記事が公開中の間だけで、自分のこのスライドへのリンクは数えません。
        </p>`,
  },
  en: {
    title: 'Put a page of slides in an article',
    lead: (n) =>
      html`Write a share URL with a page number
      (<code>https://…/@handle/name/3</code>) alone on a line in its own
      paragraph, and an image of that page is put in.`,
    body: (n) =>
      html`<p>
          Any number of pages of these slides become images. Pages of other
          slides become images for up to ${n.embedDecks} slides in one article
          (all the pages of the same slides count as one); pages of slides
          written after those are plain links.
        </p>
        <ul>
          <li>
            For a page of these slides, pressing the image moves the slides
            above to that page.
          </li>
          <li>
            For a page of someone else’s public slides, the image comes with
            “Page 3 of ‘…’ by …”, and pressing it opens that page of their
            slides.
          </li>
          <li>
            For slides that are not public, or slides or pages that do not
            exist, no image is shown and it is a plain link.
          </li>
          <li>A URL written inside a sentence is a plain link.</li>
        </ul>
        <h2>Links count as citations</h2>

        <p>
          A link in an article to the share link of other slides counts as a
          citation, just like a link inside the slides (see
          <a href="/help/community/cite-slides">Cite other slides</a>). It
          counts only while the article is published, and a link to these same
          slides does not count.
        </p>`,
  },
})
