import { html } from 'hono/html'
import { defineArticle } from '../../article'
import { legalHref, TERMS_HIDING } from '../../legal-links'

export default defineArticle({
  order: 90,
  form: 'howto',
  related: ['safety/hidden-slide', 'safety/operator', 'safety/prohibited'],
  ja: {
    title: '非表示や利用の停止に異議を申し立てる',
    lead: () =>
      html`非表示や利用の停止に納得できないときは、「お問い合わせ」のページに示す方法で、運営者に異議を申し立てます。`,
    body: () =>
      html`<ol>
          <li>
            画面の下の「お問い合わせ」を開き、示されているメールアドレスにメールを送ります。
          </li>
          <li>
            どのスライド(共有
            URL)か、またはどのアカウントかと、画面に出ている理由と日時、納得できない点を書きます。
          </li>
          <li>返事を待ちます。</li>
        </ol>
        <h2>知っておくこと</h2>
        <ul>
          <li>
            異議を申し立てられることは、利用規約の<a
              href="${legalHref('terms', TERMS_HIDING)}"
              >「${TERMS_HIDING}」</a
            >に定めてあります。同じ条に、運営者は措置の理由を説明する義務を負わない、とも定めてあります。画面に出ている理由のほかに、説明がないことがあります。
          </li>
          <li>
            アカウントの利用を止められたときは、「アカウントは停止中です」の画面に、停止の理由と日時と、「お問い合わせ」へのリンクが出ます。
          </li>
          <li>
            利用を止められているあいだは、書き出しも使えません。データがほしいときも、同じ連絡先に伝えてください。
          </li>
        </ul>`,
  },
  en: {
    title: 'Appeal a hiding or a suspension',
    lead: () =>
      html`If you do not agree with a hiding or a suspension, object to the
      operator in the way the “Contact” page gives.`,
    body: () =>
      html`<ol>
          <li>
            Open “Contact” at the bottom of the page and send an email to the
            address it shows.
          </li>
          <li>
            Say which slide (its share URL) or which account it is, the reason
            and the date the screen shows, and what you do not agree with.
          </li>
          <li>Wait for a reply.</li>
        </ol>
        <h2>Good to know</h2>
        <ul>
          <li>
            That you can object is set out in the article on hiding and
            suspension of the Terms of Service (<a
              href="${legalHref('terms', TERMS_HIDING)}"
              >Terms of Service</a
            >, in Japanese only). The same article says the operator does not
            have to explain the reason for a measure, so there may be no
            explanation beyond the reason the screen shows.
          </li>
          <li>
            When your account’s use is stopped, the “Your account is suspended”
            screen shows the reason, the time, and a link to “Contact us”.
          </li>
          <li>
            While an account is suspended, the export cannot be used either. If
            you want your data, say so to the same contact.
          </li>
        </ul>`,
  },
})
