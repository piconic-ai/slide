import { html } from 'hono/html'
import { defineArticle } from '../../article'
import { ADDRESS_EXPOSURES } from '../../../privacy/email-exposure'
import { legalHref, PRIVACY_KEEPING, PRIVACY_REQUESTS } from '../../legal-links'

export default defineArticle({
  order: 110,
  form: 'reference',
  related: ['safety/privacy', 'account/export-all', 'account/email-privacy'],
  ja: {
    title: '預かっている情報と、その守り方',
    lead: () =>
      html`預かっている情報と、その使いみち、送り先は、<a href="/privacy"
          >プライバシーポリシー</a
        >と、<a href="/privacy/external">「外部への送信」</a
        >に書いてあります。`,
    body: () =>
      html`<h2>どこで読むか</h2>
        <ul>
          <li>
            <a href="/privacy">プライバシーポリシー</a>:
            どんな情報を、何のために預かり、どれだけのあいだ残すか。
          </li>
          <li>
            <a href="/privacy/external">外部への送信</a>:
            情報を送る先と、送る情報と、目的。
          </li>
        </ul>
        <h2>メールアドレスを使う場面</h2>
        <p>
          ログインのために預けていただいたメールアドレスは、次の場面で使い、表示します。これ以外の画面、応答、ログ、運営への通知、計測の記録には出しません。
        </p>
        <ul>
          ${ADDRESS_EXPOSURES.map((exposure) => html`<li>${exposure.scene.ja}</li>`)}
        </ul>
        <h2>自分でできること</h2>
        <ul>
          <li>
            設定で、プロフィールを直し、アカウントの情報を見られます。メールアドレスがほかの人に見えるかは、<a
              href="/help/account/email-privacy"
              >メールアドレスがほかの人に見えるか確かめる</a
            >にあります。
          </li>
          <li>
            預けたスライドと記事、アカウントの情報は、手元に書き出せます(<a
              href="/help/account/export-all"
              >すべてのデータを書き出す</a
            >)。
          </li>
          <li>
            退会すると、スライド、記事、共有 URL が消えます(<a
              href="/help/account/before-leaving"
              >退会する前にデータを残す</a
            >)。消えたあとバックアップに残る期間は、プライバシーポリシーの<a
              href="${legalHref('privacy', PRIVACY_KEEPING)}"
              >「${PRIVACY_KEEPING}」</a
            >にあります。
          </li>
          <li>
            設定でできない開示や削除などは、<a
              href="${legalHref('privacy', PRIVACY_REQUESTS)}"
              >「${PRIVACY_REQUESTS}」</a
            >のとおり、お問い合わせの窓口に求めます。
          </li>
        </ul>`,
  },
  en: {
    title: 'The information we keep and how it is protected',
    lead: () =>
      html`What information is kept, what it is used for and where it is sent
        are written in the <a href="/privacy">Privacy Policy</a> and in
        <a href="/privacy/external">External transmission</a>.`,
    body: () =>
      html`<p>Both texts are in Japanese only.</p>
        <h2>Where to read</h2>
        <ul>
          <li>
            <a href="/privacy">Privacy Policy</a>: what information is kept, for
            what, and for how long.
          </li>
          <li>
            <a href="/privacy/external">External transmission</a>: where
            information is sent, which information, and for what purpose.
          </li>
        </ul>
        <h2>Where your email address is used</h2>
        <p>
          The email address you gave us to sign in is used and shown in the
          following places, and in no other screen, response, log, notice to the
          operator or count.
        </p>
        <ul>
          ${ADDRESS_EXPOSURES.map((exposure) => html`<li>${exposure.scene.en}</li>`)}
        </ul>
        <h2>What you can do yourself</h2>
        <ul>
          <li>
            In “Settings” you can fix your profile and see your account
            information. Whether others can see your email address is in
            <a href="/help/account/email-privacy"
              >Check who can see your email address</a
            >.
          </li>
          <li>
            You can write the slides and articles you put up, and your account
            information, out to your own computer (<a
              href="/help/account/export-all"
              >Export all your data</a
            >).
          </li>
          <li>
            Leaving deletes your slides, articles and share URLs (<a
              href="/help/account/before-leaving"
              >Save your data before you leave</a
            >). How long they stay in the backups afterwards is in the article
            of the Privacy Policy on how long information is kept (<a
              href="${legalHref('privacy', PRIVACY_KEEPING)}"
              >Privacy Policy</a
            >).
          </li>
          <li>
            What the settings cannot do, such as disclosure or deletion, you ask
            the contact for, as the article on such requests says (<a
              href="${legalHref('privacy', PRIVACY_REQUESTS)}"
              >Privacy Policy</a
            >).
          </li>
        </ul>`,
  },
})
