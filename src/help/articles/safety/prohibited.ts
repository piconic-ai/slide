import { html } from 'hono/html'
import { defineArticle } from '../../article'
import {
  legalHref,
  legalItems,
  legalParagraphs,
  PROHIBITED_ITEMS_EN,
  TERMS_PROHIBITED,
} from '../../legal-links'

export default defineArticle({
  order: 70,
  form: 'reference',
  related: ['safety/hidden-slide', 'safety/appeal', 'safety/terms'],
  ja: {
    title: '禁止されていること',
    lead: () =>
      html`利用者がしてはならないことは、利用規約の<a
          href="${legalHref('terms', TERMS_PROHIBITED)}"
          >「${TERMS_PROHIBITED}」</a
        >に定めてあります。`,
    body: () =>
      html`<p>利用規約の「${TERMS_PROHIBITED}」は、次のとおりです。</p>
        ${legalParagraphs('terms', TERMS_PROHIBITED).map(
          (sentence) => html`<p>${sentence}</p>`,
        )}
        <ol>
          ${legalItems('terms', TERMS_PROHIBITED).map(
            (item) => html`<li>${item}</li>`,
          )}
        </ol>
        <h2>これに反すると</h2>
        <p>
          運営は、規約に反する、またはそのおそれがあると判断したとき、スライドを非表示にしたり、アカウントの利用を止めたりすることがあります(<a
            href="/help/safety/hidden-slide"
            >スライドが非表示になったとき</a
          >)。納得できないときは、<a href="/help/safety/appeal"
            >非表示や利用の停止に異議を申し立てる</a
          >ことができます。
        </p>
        <h2>規約に反すると思うスライドを見つけたら</h2>
        <p>
          スライドを開いた画面の「通報する」から、運営に知らせられます。理由は「迷惑行為」「権利侵害」「その他」から選びます。通報するには、ログインが必要です。
        </p>`,
  },
  en: {
    title: 'What is prohibited',
    lead: () =>
      html`What users must not do is set out in the article on prohibited acts
        in the
        <a href="${legalHref('terms', TERMS_PROHIBITED)}">Terms of Service</a
        >.`,
    body: () =>
      html`<p>
          The Terms of Service are in Japanese only. Its article on prohibited
          acts says that users must not do the following.
        </p>
        <ol>
          ${PROHIBITED_ITEMS_EN.map((item) => html`<li>${item}</li>`)}
        </ol>
        <h2>If you break them</h2>
        <p>
          When the operator judges that the terms were broken, or may have been,
          it may hide slides or stop an account’s use (<a
            href="/help/safety/hidden-slide"
            >When a slide was hidden</a
          >). If you do not agree, you can
          <a href="/help/safety/appeal">appeal a hiding or a suspension</a>.
        </p>
        <h2>If you find slides you think break the terms</h2>
        <p>
          Press “Report” on the screen where the slides are open to tell the
          operator. You choose the reason from “Abuse”, “Rights infringement”
          and “Other”. You need to be signed in to report.
        </p>`,
  },
})
