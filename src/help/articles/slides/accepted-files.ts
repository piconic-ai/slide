import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 20,
  form: 'reference',
  related: ['slides/upload', 'slides/limits'],
  ja: {
    title: '置けるファイルの形を確かめる',
    lead: () => html`置けるのは、HTML 1 ファイルか、zip です。`,
    body: () =>
      html`<ul>
          <li>
            HTML 1 ファイル(<code>.html</code>)。<code>index.html</code>
            として置かれます。
          </li>
          <li>
            zip。直下に <code>index.html</code> があるか、1 つのフォルダの中に
            <code>index.html</code>
            があるものです。フォルダの中にあるときは、そのフォルダが根になります。macOS
            が足す <code>__MACOSX/</code>、<code>.DS_Store</code>、<code
              >._</code
            >
            で始まるファイルは、無いものとして扱います。<code>index.html</code>
            が決まらない zip は、受け取らずに理由をお伝えします。
          </li>
        </ul>
        <p>
          フォルダそのもののドロップ、PDF、zip 以外の圧縮形式は受け取りません。
        </p>
        <p>
          ビルドの出力にある <code>_redirects</code> と
          <code>_headers</code>
          は、置かれません。断らずに、無いものとして扱います。転送とヘッダーの設定は、slide
          では働きません。
        </p>`,
  },
  en: {
    title: 'Check which files you can put up',
    lead: () => html`You can put up one HTML file or a zip.`,
    body: (n) =>
      html`<ul>
          <li>
            One HTML file (<code>.html</code>). It is put up as
            <code>index.html</code>.
          </li>
          <li>
            A zip with <code>index.html</code> at its top, or inside the one
            folder that holds everything. In the second case that folder becomes
            the root. The <code>__MACOSX/</code> folder,
            <code>.DS_Store</code> and files starting with <code>._</code> that
            macOS adds are ignored. A zip where <code>index.html</code> cannot
            be found is refused, with the reason.
          </li>
        </ul>
        <p>
          Dropping a folder itself, PDFs and archives other than zip are not
          accepted.
        </p>
        <p>
          <code>_redirects</code> and <code>_headers</code> in a build's output
          are not put up. They are left out without refusing the files, and
          redirects and headers set in them do not work on slide.
        </p>`,
  },
})
