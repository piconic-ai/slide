import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 40,
  form: 'howto',
  related: ['sharing/stored-version', 'safety/maintenance', 'sharing/page-url'],
  ja: {
    title: '通信が切れてもスライドを読む',
    lead: (n) =>
      html`一度開いた一般公開のスライドは、通信が切れても、${n.offlineDays}
      日のあいだ、同じ URL をもう一度開くと読めます。`,
    body: (n) =>
      html`<ol>
          <li>
            通信できるうちに、読みたいスライドの共有 URL
            を開き、表示されるまで待ちます。開いたときに、ブラウザーに保存されます。
          </li>
          <li>
            通信が切れたら、同じ URL
            をもう一度開きます。保存した版が表示され、スライドの枠の上に「接続できないため、保存した版を表示しています。」と「もう一度読み込む」の帯が出ます(<a
              href="/help/sharing/stored-version"
              >「保存した版を表示しています」と出たとき</a
            >)。
          </li>
          <li>
            通信が戻ったら、「もう一度読み込む」を押します。新しい版が読め、帯が消えます。
          </li>
        </ol>
        <h2>読めるもの、読めないもの</h2>
        <ul>
          <li>
            読めるのは、一度開いた一般公開のスライドだけです。一度も開いていないスライドは、通信できないときは読めません。
          </li>
          <li>
            最後に通信で取れてから ${n.offlineDays}
            日を過ぎたものは、読めません。
          </li>
          <li>
            保存するのは ${n.offlineSlides} 本までです。${n.offlineSlides}
            本を超えて開くと、いちばん古く開いた 1 本の保存が消えます。
          </li>
          <li>
            作者だけが見られる版(限定公開、公開前、公開を止めている版)は、保存されません。
          </li>
          <li>
            通信できるときは、いつも新しい版が開きます。公開を止めたスライドや、差し替えたあとの古い版、運営が非表示にしたスライドは、通信できるときに開くと、保存したものも消えます。通信できないあいだは、そのことを知る方法がないので、作者が公開を止めたスライドも、すでに開いた人の端末では、${n.offlineDays}
            日のあいだ読めることがあります。
          </li>
          <li>
            ブラウザーが、サイトのデータの保存を止めている設定(プライベートな閲覧など)では、保存されません。そのときも、スライドはこれまでどおり表示され、エラーは出ません。
          </li>
        </ul>
        <h2>保存したものを消す</h2>
        <p>
          画面に、消すボタンはありません。ブラウザーの設定で、「サイトのデータを消す」から、slide.community
          と slideusercontent.com
          のデータを消します。スライドの保存の本体は、slideusercontent.com
          のほうです。
        </p>
        <ul>
          <li>
            Chrome: 設定 → プライバシーとセキュリティ → サードパーティ Cookie /
            サイトデータ
          </li>
          <li>
            Firefox: 設定 → プライバシーとセキュリティ → Cookie とサイトデータ →
            データを管理
          </li>
          <li>Safari: 設定 → プライバシー → Web サイトデータを管理</li>
        </ul>
        <p>
          ${n.offlineDays} 日を過ぎたものと、${n.offlineSlides}
          本を超えたものは、次にスライドを開いたときに、自動で消えます。
        </p>`,
  },
  en: {
    title: 'Read slides when you have no connection',
    lead: (n) =>
      html`A public slide you have opened once can be read again for
      ${n.offlineDays} day without a connection, by opening the same URL.`,
    body: (n) =>
      html`<ol>
          <li>
            While you are online, open the share URL of the slide and wait until
            it is shown. It is kept in your browser when you open it.
          </li>
          <li>
            When the connection is gone, open the same URL again. The stored
            version is shown, and a band over the slides says “You are offline,
            so a stored version is shown.” with “Load again” (<a
              href="/help/sharing/stored-version"
              >When it says “You are offline, so a stored version is shown”</a
            >).
          </li>
          <li>
            When you are back online, press “Load again”. The new version is
            read and the band goes away.
          </li>
        </ol>
        <h2>What can be read and what cannot</h2>
        <ul>
          <li>
            Only public slides you have opened once. A slide you have never
            opened cannot be read without a connection.
          </li>
          <li>
            Once ${n.offlineDays} day has passed since the service last answered
            for it, it cannot be read.
          </li>
          <li>
            Up to ${n.offlineSlides} slides are kept. When you open more, the
            one you opened longest ago is dropped.
          </li>
          <li>
            Versions only the author can see (unlisted, not published yet, or
            publishing stopped) are not kept.
          </li>
          <li>
            When you are online you always get the newest version. If the
            publishing was stopped, the slides were replaced, or the operator
            hid them, what was kept is dropped when you open them online. While
            you are offline there is no way to know that, so slides whose
            publishing the author stopped may still be readable on a device that
            opened them, for ${n.offlineDays} day.
          </li>
          <li>
            If your browser has stopped sites from keeping data (private
            browsing, for example), nothing is kept. The slides are still shown
            as usual, with no error.
          </li>
        </ul>
        <h2>Delete what was kept</h2>
        <p>
          There is no button for it. In your browser’s settings, use “delete
          site data” for slide.community and slideusercontent.com. The slides
          are mostly kept under slideusercontent.com.
        </p>
        <ul>
          <li>
            Chrome: Settings → Privacy and security → Third-party cookies / Site
            data
          </li>
          <li>
            Firefox: Settings → Privacy &amp; Security → Cookies and Site Data →
            Manage Data
          </li>
          <li>Safari: Settings → Privacy → Manage Website Data</li>
        </ul>
        <p>
          What is older than ${n.offlineDays} day, or beyond the
          ${n.offlineSlides} slides, is dropped by itself the next time you open
          a slide.
        </p>`,
  },
})
