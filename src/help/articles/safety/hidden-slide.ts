import { html } from 'hono/html'
import { defineArticle } from '../../article'
import { legalHref, TERMS_HIDING, TERMS_PROHIBITED } from '../../legal-links'

export default defineArticle({
  order: 80,
  form: 'howto',
  related: ['safety/prohibited', 'safety/appeal', 'account/export-all'],
  ja: {
    title: 'スライドが非表示になったとき',
    lead: () =>
      html`運営がスライドを非表示にすると、共有
      URL、一覧、表紙のどれにも、だれにも表示されません。`,
    body: () =>
      html`<ol>
          <li>
            そのスライドの編集の画面に、「運営がこのスライドを非表示にしています。」と、理由と日時が出ているかを確かめます。
          </li>
          <li>
            理由を読み、<a href="/help/safety/prohibited">禁止されていること</a
            >に当たっていないかを見ます。
          </li>
          <li>
            納得できないときは、<a href="/help/safety/appeal"
              >非表示や利用の停止に異議を申し立てる</a
            >を読んで、運営者に伝えます。
          </li>
        </ol>
        <h2>非表示のあいだ</h2>
        <ul>
          <li>
            非表示のスライドは、作者も開けません。公開の状態も変えられません(「公開する」などを押しても、「運営がこのスライドを非表示にしているため、公開状態を変えられません。」と出て、変わりません)。
          </li>
          <li>
            置いたファイルは、非表示のあいだも残っています。設定の「データを書き出す」の一覧には「運営が非表示にしています」と出て、書き出せます(<a
              href="/help/account/export-all"
              >すべてのデータを書き出す</a
            >)。
          </li>
          <li>
            運営が非表示を解除すると、非表示にしたときの公開の状態に戻ります。
          </li>
        </ul>
        <h2>非表示にされる基準</h2>
        <p>
          運営は、利用規約に反すると判断したとき、スライドを非表示にしたり削除したりできます。急を要するときは、前もって知らせずに行います。規約の定めは、<a
            href="${legalHref('terms', TERMS_HIDING)}"
            >「${TERMS_HIDING}」</a
          >です。何が規約に反するかは、<a
            href="${legalHref('terms', TERMS_PROHIBITED)}"
            >「${TERMS_PROHIBITED}」</a
          >に定めてあります。
        </p>`,
  },
  en: {
    title: 'When a slide was hidden',
    lead: () =>
      html`When the operator hides a slide, nobody can see it at its share URL,
      as a cover, or in any list.`,
    body: () =>
      html`<ol>
          <li>
            Check that the slide’s edit page says “The operator has hidden these
            slides.”, with a reason and a date.
          </li>
          <li>
            Read the reason and see whether it is one of the things in
            <a href="/help/safety/prohibited">What is prohibited</a>.
          </li>
          <li>
            If you do not agree, read
            <a href="/help/safety/appeal">Appeal a hiding or a suspension</a>
            and tell the operator.
          </li>
        </ol>
        <h2>While it is hidden</h2>
        <ul>
          <li>
            Even you cannot open a hidden slide, and you cannot change its
            publishing (if you press “Publish” and the like, “Nothing was
            changed: the operator has hidden these slides, so their publication
            cannot be changed.” appears).
          </li>
          <li>
            The files you put up are still kept. In the list under “Export your
            data” in “Settings” it says “Hidden by the operator”, and you can
            take it out (<a href="/help/account/export-all"
              >Export all your data</a
            >).
          </li>
          <li>
            When the operator lifts the hiding, the slide is back in the state
            of publishing it had when it was hidden.
          </li>
        </ul>
        <h2>What a slide can be hidden for</h2>
        <p>
          When the operator judges that the Terms of Service were broken, it may
          hide or delete slides. When it is urgent, it does so without telling
          you beforehand. The Terms of Service set this out in the article on
          hiding and suspension (<a href="${legalHref('terms', TERMS_HIDING)}"
            >Terms of Service</a
          >), and what counts as breaking them in the article on prohibited acts
          (<a href="${legalHref('terms', TERMS_PROHIBITED)}">Terms of Service</a
          >). Both are in Japanese only.
        </p>`,
  },
})
