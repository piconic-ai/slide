import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 50,
  form: 'howto',
  related: ['sharing/read-offline', 'safety/maintenance'],
  ja: {
    title: '「保存した版を表示しています」と出たとき',
    lead: () =>
      html`「接続できないため、保存した版を表示しています」と出ているときは、以前に開いたときに保存した版を見ているので、通信が戻ってから「もう一度読み込む」を押すと、新しい版が読めます。`,
    body: (n) =>
      html`<ol>
          <li>Wi-Fi やモバイルの通信がつながっているかを確かめます。</li>
          <li>
            スライドの枠の上の帯の「もう一度読み込む」を押します。通信が戻っていれば、新しい版が読め、帯が消えます。戻っていなければ、保存した版のまま、帯が残ります。
          </li>
          <li>
            通信できるのに帯が続くときは、サービスが混み合っているか、メンテナンス中かもしれません。しばらくしてから、もう一度押してください(<a
              href="/help/safety/maintenance"
              >メンテナンス中です、と出たとき</a
            >)。
          </li>
        </ol>
        <h2>この帯が出るとき</h2>
        <ul>
          <li>
            通信できないときと、サービスが応えないとき(混み合っているとき、メンテナンス中を含む)に、保存した版が表示され、帯が出ます。通信できるときは、帯は出ず、いつも新しい版が開きます。
          </li>
          <li>
            保存した版は、新しい版が公開されたあとも、通信が戻るまでは、そのまま表示されます。
          </li>
          <li>
            最後に通信で取れてから ${n.offlineDays}
            日を過ぎた版は、保存したものでも表示されません。
          </li>
        </ul>
        <h2>保存した版が出ないとき</h2>
        <p>
          一度も開いていないスライドは、通信できないと読めません。保存のしくみと、保存したものを消す方法は、<a
            href="/help/sharing/read-offline"
            >通信が切れてもスライドを読む</a
          >を読んでください。
        </p>`,
  },
  en: {
    title: 'When it says “You are offline, so a stored version is shown”',
    lead: () =>
      html`When it says “You are offline, so a stored version is shown.”, you
      are looking at the version kept from when you opened it before, so press
      “Load again” once you are back online to read the new one.`,
    body: (n) =>
      html`<ol>
          <li>Check that your Wi-Fi or mobile connection is working.</li>
          <li>
            Press “Load again” in the band over the slides. If you are back
            online, the new version is read and the band goes away. If not, the
            stored version stays and so does the band.
          </li>
          <li>
            If you are online and the band stays, the service may be busy or
            under maintenance. Press it again in a while (<a
              href="/help/safety/maintenance"
              >When it says “Under maintenance”</a
            >).
          </li>
        </ol>
        <h2>When the band shows</h2>
        <ul>
          <li>
            When you have no connection, or the service does not answer (it is
            busy, or under maintenance), the stored version is shown with the
            band. When you are online there is no band and you always get the
            newest version.
          </li>
          <li>
            A stored version stays as it is, even after a new version is
            published, until you are back online.
          </li>
          <li>
            A version the service last answered for more than ${n.offlineDays}
            day ago is not shown, even if it is stored.
          </li>
        </ul>
        <h2>When no stored version appears</h2>
        <p>
          A slide you have never opened cannot be read without a connection. For
          how it is kept, and how to delete what was kept, read
          <a href="/help/sharing/read-offline"
            >Read slides when you have no connection</a
          >.
        </p>`,
  },
})
