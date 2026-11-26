import { html } from 'hono/html'
import { defineArticle } from '../../article'
import {
  legalHref,
  legalIsDraft,
  TERMS_HIDING,
  TERMS_PROHIBITED,
  TERMS_TAKING_OUT,
} from '../../legal-links'

export default defineArticle({
  order: 40,
  form: 'reference',
  related: ['safety/prohibited', 'safety/hidden-slide', 'safety/privacy'],
  ja: {
    title: '利用規約を読む',
    lead: () =>
      html`<a href="/terms">利用規約</a>は、ページの下の「規約」から読めます。`,
    body: () =>
      html`${
          legalIsDraft('terms')
            ? html`<p>
                いまの利用規約は下書きで、題名に「(下書き)」と出ています。正式な内容は、施行日を入れて公開します。
              </p>`
            : ''
        }
        <p>
          利用規約は、日本語だけです。表示言語を英語にしても、日本語の文面が出ます。条ごとに位置があり、リンクで条へ直接来られます。変更の履歴は、末尾の「附則」にあります。
        </p>
        <h2>知りたいことから探す</h2>
        <ul>
          <li>
            してはならないこと:
            <a href="${legalHref('terms', TERMS_PROHIBITED)}"
              >「${TERMS_PROHIBITED}」</a
            >(<a href="/help/safety/prohibited">禁止されていること</a>)
          </li>
          <li>
            スライドを非表示にされたとき、利用を止められたとき:
            <a href="${legalHref('terms', TERMS_HIDING)}">「${TERMS_HIDING}」</a
            >(<a href="/help/safety/hidden-slide"
              >スライドが非表示になったとき</a
            >)
          </li>
          <li>
            自分のスライドや記事を取り出すとき:
            <a href="${legalHref('terms', TERMS_TAKING_OUT)}"
              >「${TERMS_TAKING_OUT}」</a
            >(<a href="/help/account/export-all">すべてのデータを書き出す</a>)
          </li>
        </ul>
        <p>
          情報の取り扱いは、<a href="/privacy">プライバシーポリシー</a
          >に定めてあります(<a href="/help/safety/privacy"
            >プライバシーポリシーを読む</a
          >)。
        </p>`,
  },
  en: {
    title: 'Read the Terms of Service',
    lead: () =>
      html`You can read the <a href="/terms">Terms of Service</a> from “Terms”
        at the bottom of the page.`,
    body: () =>
      html`${
          legalIsDraft('terms')
            ? html`<p>
                The Terms of Service are a draft for now, and the page marks its
                title as a draft. The final text will be published with the date
                it takes effect.
              </p>`
            : ''
        }
        <p>
          The Terms of Service are in Japanese only. Even when the screen
          language is English, the Japanese text is shown. Each article has its
          own place, so a link can lead straight to it. The history of changes
          is at the end, under the supplementary provisions.
        </p>
        <h2>Find what you want to know</h2>
        <ul>
          <li>
            What you must not do: the article on prohibited acts (<a
              href="${legalHref('terms', TERMS_PROHIBITED)}"
              >Terms of Service</a
            >; <a href="/help/safety/prohibited">What is prohibited</a>)
          </li>
          <li>
            When a slide was hidden or your use was stopped: the article on
            hiding and suspension (<a href="${legalHref('terms', TERMS_HIDING)}"
              >Terms of Service</a
            >; <a href="/help/safety/hidden-slide">When a slide was hidden</a>)
          </li>
          <li>
            Taking out your slides and articles: the article on taking out
            content (<a href="${legalHref('terms', TERMS_TAKING_OUT)}"
              >Terms of Service</a
            >; <a href="/help/account/export-all">Export all your data</a>)
          </li>
        </ul>
        <p>
          How information is handled is set out in the
          <a href="/privacy">Privacy Policy</a> (<a href="/help/safety/privacy"
            >Read the Privacy Policy</a
          >).
        </p>`,
  },
})
