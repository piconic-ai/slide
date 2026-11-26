import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 50,
  form: 'howto',
  related: ['account/reupload-zip', 'account/export-all', 'slides/replace'],
  ja: {
    title: 'スライドを zip で受け取る',
    lead: () =>
      html`スライドの編集の画面の「ダウンロード」で、「公開中の版(zip)」を押すと、置いたままのファイルを
      zip で受け取れます。`,
    body: (n) =>
      html`<ol>
          <li>「スライドの管理」で、受け取りたいスライドを開きます。</li>
          <li>
            「ダウンロード」の枠で、「公開中の版(zip)」を押します。公開中の版より新しい版を置いてあるときは、「準備済みの版(zip)」も出ます。
          </li>
          <li>
            記事を書いてあるスライドでは「記事(Markdown)」も、どのスライドでも「スライドの情報(JSON)」も受け取れます。
          </li>
        </ol>
        <h2>zip に入るもの</h2>
        <ul>
          <li>
            置いたときのファイルが、置いたときのパスのまま入ります。サービスが配信のときに足すものは入りません。
          </li>
          <li>
            記事とスライドの情報は、zip
            には入りません。置き直したときに、余分なファイルとして公開されないようにするためです。
          </li>
          <li>
            限定公開のスライドも、非公開のスライドも受け取れます。残している過去の版は受け取れません。
          </li>
          <li>
            まだ公開していないスライドは、いちばん新しく受け取った版が「準備済みの版(zip)」になります。公開を止めているスライドの「公開中の版(zip)」には、もう一度公開すると戻る版が入ります。
          </li>
        </ul>
        <h2>受け取れないとき</h2>
        <ul>
          <li>
            「書き出しが終わるのを待っています」と出たときは、このアカウントで別の
            zip を作っている最中です。終わってから、もう一度押してください。
          </li>
          <li>
            「この版は、書き出せる大きさを超えています」と出たときは、1 つの zip
            に入るのが ${n.zipFiles} ファイル、${n.zipMb} MB
            までなので、超えています。お問い合わせください。
          </li>
          <li>
            「書き出せませんでした」と出たときは、保存したファイルの一部を読めませんでした。時間をおいて、もう一度押してください。続くときは、お問い合わせください。
          </li>
          <li>
            利用を止められているアカウントでは、書き出しのリンクを使えません。お問い合わせください。
          </li>
        </ul>`,
  },
  en: {
    title: 'Take a slide out as a zip',
    lead: () =>
      html`Press “Published version (zip)” under “Download” on the slide’s edit
      page to get the files as you put them, in a zip.`,
    body: (n) =>
      html`<ol>
          <li>Open the slide you want from “Your slides”.</li>
          <li>
            In the “Download” frame, press “Published version (zip)”. If you
            have put up a newer version than the public one, “Prepared version
            (zip)” is there too.
          </li>
          <li>
            If the slide has an article you can also take “Article (Markdown)”,
            and for every slide “Slide information (JSON)”.
          </li>
        </ol>
        <h2>What is in the zip</h2>
        <ul>
          <li>
            The files you put up, at the paths you put them. Nothing the service
            adds when it serves the slides is in it.
          </li>
          <li>
            The article and the slide’s information are not in the zip, so that
            they are not published as extra files when you put the zip up again.
          </li>
          <li>
            Unlisted and private slides can be taken too. Past versions you keep
            cannot.
          </li>
          <li>
            A slide you have not published has its newest version as “Prepared
            version (zip)”. For a slide whose publishing you stopped, “Published
            version (zip)” holds the version that comes back when you publish
            again.
          </li>
        </ul>
        <h2>When you cannot take it</h2>
        <ul>
          <li>
            “Waiting for another export to finish” means a zip is being made for
            this account already. Press the link again when it has finished.
          </li>
          <li>
            “This version is too large to export” means it is over what one zip
            can hold: ${n.zipFiles} files or ${n.zipMb} MB. Please contact us.
          </li>
          <li>
            “Could not export” means some stored files could not be read. Try
            again in a while; if it keeps happening, please contact us.
          </li>
          <li>
            An account that is suspended cannot use the export links. Please
            contact us.
          </li>
        </ul>`,
  },
})
