import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'
import type { ReportedHosts } from './store'

const text = messages({
  ja: {
    summary: 'このスライドにできること・できないこと',
    lead: 'スライドは作者が作ったプログラムです。ブラウザは、スライドに次の操作をさせません。',
    blockedHeading: 'ブラウザが止めている操作',
    blocked: [
      'このページ全体を別のサイトへ移動させる',
      '別のタブやウィンドウを開く',
      'ファイルをダウンロードさせる',
      'ページを閉じたあとも動き続ける仕組みを残す',
      'slide のログイン情報や管理画面に触れる',
    ],
    hostsHeading: '外部との通信',
    hostsNote:
      'スライドは外部と通信できます。通信先には、あなたの IP アドレスと、このスライドを開いたことが伝わります。枠の中であなたが入力した内容も、送ることができます。',
    hostsListed:
      '次は、読者のブラウザから報告された通信先です。誰でも報告を送れるので、正確とは限りません。報告されていない通信先があることもあります。',
    more: 'このほかにも通信先が報告されています。',
    noHosts:
      '外部との通信は、まだ報告されていません。通信しないことを示すものではありません。',
    caution:
      '枠の中(全画面にしたときも)の表示は作者が作ったもので、別のサイトの画面に切り替わることもあります。そこにログイン画面が出ても、パスワードを入力しないでください。',
  },
  en: {
    summary: 'What these slides can and cannot do',
    lead: 'Slides are a program their author wrote. Your browser does not let them do the following.',
    blockedHeading: 'What your browser stops',
    blocked: [
      'Sending this whole page to another site',
      'Opening other tabs or windows',
      'Downloading files',
      'Leaving something that keeps running after you close the page',
      'Reaching your slide sign-in or dashboard',
    ],
    hostsHeading: 'Talking to other sites',
    hostsNote:
      'Slides can talk to other sites. Those sites learn your IP address and that you opened these slides. Slides can also send what you type inside the frame.',
    hostsListed:
      'These are the sites readers’ browsers have reported. Anyone can send a report, so the list may be wrong, and some sites may be missing.',
    more: 'More sites than these have been reported.',
    noHosts:
      'No other site has been reported yet. That does not show the slides talk to none.',
    caution:
      'What the frame shows, in full screen too, was made by the author, and it can switch to another site’s screen. If a sign-in screen appears there, do not type your password.',
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
 * refuses them, and the hosts they have been seen to reach. Every state of
 * the list is in the markup, so the viewer's script can show the hosts
 * reported since the page was made by hiding and unhiding, with no wording
 * of its own. `hostsUrl` is where it reads them.
 */
export function safetySection(
  hosts: ReportedHosts,
  hostsUrl: string,
  lang: Lang,
) {
  const t = text[lang]
  const any = hosts.shown.length > 0
  return html`<details class="safety" data-hosts="${hostsUrl}">
    <summary>${t.summary}</summary>
    <p>${t.lead}</p>
    <h2>${t.blockedHeading}</h2>
    <ul>
      ${t.blocked.map((item) => html`<li>${item}</li>`)}
    </ul>
    <h2>${t.hostsHeading}</h2>
    <p>${t.hostsNote}</p>
    <p data-hosts-listed ${any ? '' : 'hidden'}>${t.hostsListed}</p>
    <ul class="hosts" ${any ? '' : 'hidden'}>
      ${hosts.shown.map((host) => html`<li><code>${host}</code></li>`)}
    </ul>
    <p data-hosts-more ${hosts.more ? '' : 'hidden'}>${t.more}</p>
    <p data-hosts-none ${any ? 'hidden' : ''}>${t.noHosts}</p>
    <p>${t.caution}</p>
  </details>`
}
