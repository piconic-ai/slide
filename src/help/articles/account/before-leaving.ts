import { html } from 'hono/html'
import { defineArticle } from '../../article'
import { legalHref, PRIVACY_KEEPING, TERMS_LEAVING } from '../../legal-links'

export default defineArticle({
  order: 80,
  form: 'howto',
  related: ['account/export-all', 'account/export-slide', 'safety/privacy'],
  ja: {
    title: '退会する前にデータを残す',
    lead: () =>
      html`退会するとスライド、記事、共有 URL
      が消えるので、先に「データを書き出す」で手元に残します。`,
    body: () =>
      html`<ol>
          <li>
            「設定」の「退会」の枠の「退会の前に、データを書き出せます。」にある「データを書き出す」を押します。
          </li>
          <li>
            「データを書き出す」で、アカウントの情報と、残したいスライドを受け取ります(<a
              href="/help/account/export-all"
              >すべてのデータを書き出す</a
            >)。
          </li>
          <li>
            受け取れたことを確かめてから、「退会」の枠の「確認のため、ハンドルを入力してください」に自分のハンドルを入力し、「退会する」を押します。
          </li>
        </ol>
        <h2>知っておくこと</h2>
        <ul>
          <li>
            退会すると、スライド、記事、共有 URL
            が消えます。元に戻す操作はありません。
          </li>
          <li>
            入力したハンドルが違うと、「入力したハンドルが一致しません。何も削除していません。」と出て、何も消えません。
          </li>
          <li>
            退会のあと、バックアップから消えるまでの期間は、プライバシーポリシーの<a
              href="${legalHref('privacy', PRIVACY_KEEPING)}"
              >「${PRIVACY_KEEPING}」</a
            >に書いてあります。退会については、利用規約の<a
              href="${legalHref('terms', TERMS_LEAVING)}"
              >「${TERMS_LEAVING}」</a
            >があります。
          </li>
          <li>
            利用を止められているアカウントの退会の確認には、書き出しへのリンクが出ません。書き出したいときは、退会の前にお問い合わせください。
          </li>
        </ul>`,
  },
  en: {
    title: 'Save your data before you leave',
    lead: () =>
      html`Leaving deletes your slides, articles and share URLs, so take them
      out first with “Export your data”.`,
    body: () =>
      html`<ol>
          <li>
            In “Settings”, in the frame for leaving, press “Export your data”
            next to “Before you leave, you can export your data.”
          </li>
          <li>
            On “Export your data”, take your account information and the slides
            you want to keep (<a href="/help/account/export-all"
              >Export all your data</a
            >).
          </li>
          <li>
            Once you have them, type your handle under “To confirm, type your
            handle” in that frame and press “Delete account”.
          </li>
        </ol>
        <h2>Good to know</h2>
        <ul>
          <li>
            Leaving deletes your slides, articles and share URLs. There is no
            way to undo it.
          </li>
          <li>
            If the handle you type does not match, “The handle you typed does
            not match. Nothing was deleted.” appears and nothing is deleted.
          </li>
          <li>
            How long it takes for what you deleted to leave the backups is in
            the Privacy Policy, under its article on how long information is
            kept (<a href="${legalHref('privacy', PRIVACY_KEEPING)}"
              >Privacy Policy</a
            >). The Terms of Service have an article on leaving too (<a
              href="${legalHref('terms', TERMS_LEAVING)}"
              >Terms of Service</a
            >). Both texts are in Japanese only.
          </li>
          <li>
            The leaving screen of a suspended account has no link to the export.
            If you want your data, contact us before you leave.
          </li>
        </ul>`,
  },
})
