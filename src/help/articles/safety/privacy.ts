import { html } from 'hono/html'
import { defineArticle } from '../../article'
import {
  legalHref,
  legalIsDraft,
  PRIVACY_KEEPING,
  PRIVACY_REQUESTS,
} from '../../legal-links'

export default defineArticle({
  order: 50,
  form: 'reference',
  related: ['safety/data-we-keep', 'safety/terms', 'account/email-privacy'],
  ja: {
    title: 'プライバシーポリシーを読む',
    lead: () =>
      html`<a href="/privacy">プライバシーポリシー</a
        >は、ページの下の「プライバシー」から読めます。`,
    body: () =>
      html`${
          legalIsDraft('privacy')
            ? html`<p>
                いまのプライバシーポリシーは下書きで、題名に「(下書き)」と出ています。正式な内容は、施行日を入れて公開します。
              </p>`
            : ''
        }
        <p>
          プライバシーポリシーは、日本語だけです。表示言語を英語にしても、日本語の文面が出ます。条ごとに位置があり、リンクで条へ直接来られます。変更の履歴は、末尾の「附則」にあります。
        </p>
        <h2>知りたいことから探す</h2>
        <ul>
          <li>
            情報を送る先: <a href="/privacy/external">「外部への送信」</a>
          </li>
          <li>
            情報を残す期間:
            <a href="${legalHref('privacy', PRIVACY_KEEPING)}"
              >「${PRIVACY_KEEPING}」</a
            >
          </li>
          <li>
            開示、訂正、削除などを求めるとき:
            <a href="${legalHref('privacy', PRIVACY_REQUESTS)}"
              >「${PRIVACY_REQUESTS}」</a
            >
          </li>
        </ul>
        <p>
          預かっている情報と守り方は、<a href="/help/safety/data-we-keep"
            >預かっている情報と、その守り方</a
          >にまとめてあります。
        </p>`,
  },
  en: {
    title: 'Read the Privacy Policy',
    lead: () =>
      html`You can read the <a href="/privacy">Privacy Policy</a> from “Privacy”
        at the bottom of the page.`,
    body: () =>
      html`${
          legalIsDraft('privacy')
            ? html`<p>
                The Privacy Policy is a draft for now, and the page marks its
                title as a draft. The final text will be published with the date
                it takes effect.
              </p>`
            : ''
        }
        <p>
          The Privacy Policy is in Japanese only. Even when the screen language
          is English, the Japanese text is shown. Each article has its own
          place, so a link can lead straight to it. The history of changes is at
          the end, under the supplementary provisions.
        </p>
        <h2>Find what you want to know</h2>
        <ul>
          <li>
            Where information is sent:
            <a href="/privacy/external">External transmission</a>
          </li>
          <li>
            How long information is kept: the article on it (<a
              href="${legalHref('privacy', PRIVACY_KEEPING)}"
              >Privacy Policy</a
            >)
          </li>
          <li>
            Asking for disclosure, correction or deletion: the article on such
            requests (<a href="${legalHref('privacy', PRIVACY_REQUESTS)}"
              >Privacy Policy</a
            >)
          </li>
        </ul>
        <p>
          What is kept and how it is protected is gathered in
          <a href="/help/safety/data-we-keep"
            >The information we keep and how it is protected</a
          >.
        </p>`,
  },
})
