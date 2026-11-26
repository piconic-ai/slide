import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 60,
  form: 'howto',
  related: ['safety/operator', 'slides/upload', 'sharing/stored-version'],
  ja: {
    title: 'メンテナンス中です、と出たとき',
    lead: () =>
      html`「メンテナンス中です」と出たときは、運営がサービスを止めているので、しばらくしてから、もう一度開いてください。`,
    body: () =>
      html`<ol>
          <li>
            画面に「(日時)ごろに終わる見込みです。」と出ているときは、その時刻を目安に待ちます。見込みが出ていないときは、運営がまだ終わりの時刻を決めていません。見込みは延びることがあります。
          </li>
          <li>しばらくしてから、もう一度開きます。</li>
          <li>
            急ぐときは、止まっているあいだも読めるページを使います。「ヘルプ」「利用規約」「プライバシーポリシー」「お問い合わせ」は、画面のリンクから開けます。
          </li>
        </ol>
        <h2>画面に出ること</h2>
        <ul>
          <li>
            止めている理由が、「データベースの保守のため、サービスを止めています。」「サービスの更新のため、サービスを止めています。」「その他の作業のため、サービスを止めています。」のどれかで出ます。
          </li>
          <li>
            置いたスライドは消えません。止まっているあいだはスライドを置けないので、終わってからもう一度置いてください。置いている途中だったものも、終わってからもう一度置きます。
          </li>
          <li>
            一度開いたスライドは、止まっているあいだも、保存した版で読めることがあります(<a
              href="/help/sharing/stored-version"
              >「保存した版を表示しています」と出たとき</a
            >)。一度も開いていないスライドは読めません。
          </li>
        </ul>
        <h2>前もって知らせる帯</h2>
        <p>
          予定が決まっているときは、すべてのページの上に、「(日時)から(日時)まで(日本時間)、メンテナンスのためサービスを止めます。」という帯が出て、「詳しくはヘルプへ」から、このページに来られます。帯は予告です。始まる時刻までは、ふつうに使えます。終わりの時刻を過ぎると、帯は消えます。
        </p>
        <h2>うまくいかないとき</h2>
        <p>
          見込みの時刻を過ぎても「メンテナンス中です」が続くときは、時間をおいてもう一度開いてください。それでも続くときは、お問い合わせください。
        </p>`,
  },
  en: {
    title: 'When it says “Under maintenance”',
    lead: () =>
      html`When it says “Under maintenance”, the operator has stopped the
      service, so come back and open it again in a little while.`,
    body: () =>
      html`<ol>
          <li>
            If the screen says “We expect to be back around …”, wait until about
            then. If it gives no time, the operator has not decided when it will
            end. The time can move later.
          </li>
          <li>Open the page again in a little while.</li>
          <li>
            If you are in a hurry, use the pages you can still read while it is
            stopped: “Help”, “Terms of Service”, “Privacy Policy” and “Contact”
            are linked on the screen.
          </li>
        </ol>
        <h2>What the screen says</h2>
        <ul>
          <li>
            The reason is one of “The service is stopped for database
            maintenance.”, “The service is stopped for an update.” and “The
            service is stopped for other work.”
          </li>
          <li>
            The slides you put up are not lost. You cannot put slides up while
            it is stopped, so put them up again when it is over. That includes
            an upload that was in progress.
          </li>
          <li>
            A slide you have opened before can often still be read from the
            version kept in your browser (<a href="/help/sharing/stored-version"
              >When it says “You are offline, so a stored version is shown”</a
            >). A slide you have never opened cannot be read.
          </li>
        </ul>
        <h2>The band that tells you beforehand</h2>
        <p>
          When a time has been set, a band over the top of every page says “We
          will stop the service for maintenance from … to ….”, and “Details in
          the Help” leads to this page. The band is a notice: until the start
          time you can use the service as usual. After the end time the band
          goes away.
        </p>
        <h2>When it does not work</h2>
        <p>
          If “Under maintenance” goes on past the time it gave, open the page
          again after a while. If it still goes on, please contact us.
        </p>`,
  },
})
