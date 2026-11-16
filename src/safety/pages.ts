import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'
import type { ReportedHosts } from './store'

/** Where the help page explains what holds for every slide. */
export const SAFETY_HELP_PATH = '/help#safety'

const text = messages({
  ja: {
    summary: 'このスライドの通信先',
    listed: '読者のブラウザから、次の通信先が報告されています。',
    more: 'このほかにも通信先が報告されています。',
    noHosts: '外部との通信は、まだ報告されていません。',
    limit: '報告にもとづく一覧で、すべての通信先とは限りません。',
    help: 'スライドにできること・できないこと',
    helpHeading: '知らない人のスライドを開くとき',
    helpLead:
      'スライドは作者が作ったプログラムで、ページの中の枠で動きます。作者を知らなくても開けるように、できることを次のように限っています。',
    blockedHeading: 'スライドにできないこと',
    blockedLead: 'ブラウザは、スライドに次の操作をさせません。',
    blocked: [
      'ページ全体を別のサイトへ移動させる',
      '別のタブやウィンドウを開く',
      'ファイルをダウンロードさせる',
      'ページを閉じたあとも動き続ける仕組みを残す',
      'slide のログイン情報や管理画面に触れる',
    ],
    hostsHeading: 'スライドにできること: 外部との通信',
    hostsNote:
      'スライドは外部と通信できます。通信先には、あなたの IP アドレスと、そのスライドを開いたことが伝わります。枠の中であなたが入力した内容も、送ることができます。',
    listHeading: '「このスライドの通信先」の読み方',
    listNote:
      'スライドのページにある「このスライドの通信先」は、読者のブラウザからの報告をまとめたものです。誰でも報告を送れるので、正確とは限りません。報告されていない通信先があることもあります。「まだ報告されていません」は、通信しないことを示すものではありません。',
    cautionHeading: '気をつけること',
    caution:
      '枠の中(全画面にしたときも)の表示は作者が作ったもので、別のサイトの画面に切り替わることもあります。そこにログイン画面が出ても、パスワードを入力しないでください。',
  },
  en: {
    summary: 'Sites these slides talk to',
    listed: 'Readers’ browsers have reported these sites.',
    more: 'More sites than these have been reported.',
    noHosts: 'No other site has been reported yet.',
    limit: 'The list comes from reports, so some sites may be missing.',
    help: 'What slides can and cannot do',
    helpHeading: 'Opening slides from someone you do not know',
    helpLead:
      'Slides are a program their author wrote, and they run in a frame inside the page. So that you can open them without knowing the author, what they can do is limited as follows.',
    blockedHeading: 'What slides cannot do',
    blockedLead: 'Your browser does not let slides do the following.',
    blocked: [
      'Sending the whole page to another site',
      'Opening other tabs or windows',
      'Downloading files',
      'Leaving something that keeps running after you close the page',
      'Reaching your slide sign-in or dashboard',
    ],
    hostsHeading: 'What slides can do: talk to other sites',
    hostsNote:
      'Slides can talk to other sites. Those sites learn your IP address and that you opened the slides. Slides can also send what you type inside the frame.',
    listHeading: 'How to read “Sites these slides talk to”',
    listNote:
      '“Sites these slides talk to” on a slide page gathers what readers’ browsers have reported. Anyone can send a report, so the list may be wrong, and some sites may be missing. “No other site has been reported yet” does not show the slides talk to none.',
    cautionHeading: 'Take care',
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
  .safety p {
    margin: 6px 0;
  }
  .safety ul {
    margin: 0;
    padding-left: 1.4em;
  }
  .safety .hosts {
    overflow-wrap: anywhere;
  }`

/**
 * What is particular to these slides: the hosts they have been seen to
 * reach. What holds for every slide is on the help page this links to.
 * Every state of the list is in the markup, so the viewer's script can show
 * the hosts reported since the page was made by hiding and unhiding, with no
 * wording of its own. `hostsUrl` is where it reads them.
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
    <p data-hosts-listed ${any ? '' : 'hidden'}>${t.listed}</p>
    <ul class="hosts" ${any ? '' : 'hidden'}>
      ${hosts.shown.map((host) => html`<li><code>${host}</code></li>`)}
    </ul>
    <p data-hosts-more ${hosts.more ? '' : 'hidden'}>${t.more}</p>
    <p data-hosts-none ${any ? 'hidden' : ''}>${t.noHosts}</p>
    <p>
      ${t.limit}
      <a href="${SAFETY_HELP_PATH}">${t.help}</a>
    </p>
  </details>`
}

/** What every reader may rely on, whichever slides they open. */
export function safetyHelp(lang: Lang) {
  const t = text[lang]
  return html`<section id="safety">
    <h2>${t.helpHeading}</h2>
    <p>${t.helpLead}</p>
    <h3>${t.blockedHeading}</h3>
    <p>${t.blockedLead}</p>
    <ul>
      ${t.blocked.map((item) => html`<li>${item}</li>`)}
    </ul>
    <h3>${t.hostsHeading}</h3>
    <p>${t.hostsNote}</p>
    <h3>${t.listHeading}</h3>
    <p>${t.listNote}</p>
    <h3>${t.cautionHeading}</h3>
    <p>${t.caution}</p>
  </section>`
}
