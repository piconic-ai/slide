import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 40,
  form: 'reference',
  related: ['articles/write', 'articles/embed-page'],
  ja: {
    title: '記事に使える書き方を知る',
    lead: () =>
      html`記事に使えるのは、CommonMark と、表、取り消し線、自動リンクです。`,
    body: () =>
      html`<ul>
        <li>
          使えるのは、CommonMark(見出し、段落、箇条書き、引用、コード、リンクなど)と、表、取り消し線、自動リンクです。
        </li>
        <li>
          HTML と script
          は使えません。書くと、文字として表示されます。画像も入れられません。
        </li>
        <li>
          リンクは <code>https:</code>、<code>http:</code>、<code>mailto:</code>
          だけです。読者には、外へのリンクとして開きます。
        </li>
        <li>見出しは、記事の中の小見出しとして表示されます。</li>
      </ul>`,
  },
  en: {
    title: 'Know what you can write in an article',
    lead: () =>
      html`An article can use CommonMark, tables, strikethrough and autolinks.`,
    body: (n) =>
      html`<ul>
        <li>
          CommonMark (headings, paragraphs, lists, quotes, code, links and so
          on) works, and so do tables, strikethrough and automatic links.
        </li>
        <li>
          HTML and scripts do not work: they are shown as text. Images cannot be
          put in.
        </li>
        <li>
          Links can be <code>https:</code>, <code>http:</code> or
          <code>mailto:</code> only. They open as links to other sites.
        </li>
        <li>Headings show as sub-headings of the article.</li>
      </ul>`,
  },
})
