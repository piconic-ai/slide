import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: {
    summary: 'このスライドにできること・できないこと',
    lead: 'スライドは作者が作ったプログラムで、このページの枠の中だけで動きます。',
    blockedHeading: 'ブラウザが止めている操作',
    blocked: [
      'このページを別のサイトへ移動させる',
      '別のタブやウィンドウを開く',
      'ファイルをダウンロードさせる',
      'フォームを送信する',
      'ページを閉じたあとも動き続ける仕組みを残す',
      'slide のログイン情報や管理画面に触れる',
    ],
    hostsHeading: '外部との通信',
    hostsNote:
      'スライドは外部と通信できます。通信先には、あなたの IP アドレスと、このスライドを開いたことが伝わります。次は、読者のブラウザが報告した通信先です。',
    noHosts: '外部との通信は、まだ報告されていません。',
    caution:
      '枠の中の表示は作者が作ったものです。枠の中にログイン画面が出ても、パスワードを入力しないでください。',
  },
  en: {
    summary: 'What these slides can and cannot do',
    lead: 'Slides are a program their author wrote, and they run only inside the frame on this page.',
    blockedHeading: 'What your browser stops',
    blocked: [
      'Sending this page to another site',
      'Opening other tabs or windows',
      'Downloading files',
      'Submitting forms',
      'Leaving something that keeps running after you close the page',
      'Reaching your slide sign-in or dashboard',
    ],
    hostsHeading: 'Talking to other sites',
    hostsNote:
      'Slides can talk to other sites. Those sites learn your IP address and that you opened these slides. These are the sites readers’ browsers have reported.',
    noHosts: 'No other site has been reported yet.',
    caution:
      'What the frame shows was made by the author. If a sign-in screen appears inside it, do not type your password.',
  },
})

export const safetyStyle = `
  .safety {
    max-width: 60em;
    margin: 12px 0;
    line-height: 1.7;
  }
  .safety summary {
    cursor: pointer;
  }
  .safety h2 {
    font-size: 15px;
    margin: 12px 0 4px;
  }
  .safety ul {
    margin: 0;
    padding-left: 1.4em;
  }
  .safety .hosts {
    overflow-wrap: anywhere;
  }`

/**
 * What a reader may rely on while a stranger's slides run: what the browser
 * refuses them, and the hosts they have been seen to reach.
 */
export function safetySection(hosts: readonly string[], lang: Lang) {
  const t = text[lang]
  return html`<details class="safety">
    <summary>${t.summary}</summary>
    <p>${t.lead}</p>
    <h2>${t.blockedHeading}</h2>
    <ul>
      ${t.blocked.map((item) => html`<li>${item}</li>`)}
    </ul>
    <h2>${t.hostsHeading}</h2>
    <p>${t.hostsNote}</p>
    ${
      hosts.length
        ? html`<ul class="hosts">
            ${hosts.map((host) => html`<li><code>${host}</code></li>`)}
          </ul>`
        : html`<p>${t.noHosts}</p>`
    }
    <p>${t.caution}</p>
  </details>`
}
