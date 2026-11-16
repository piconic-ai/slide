import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'

/** Where the help page explains what holds for every slide. */
export const SAFETY_HELP_PATH = '/help#safety'

const text = messages({
  ja: {
    helpHeading: '知らない人のスライドを開くとき',
    helpLead:
      'スライドは作者が作ったプログラムで、ページの中の枠で動きます。スライドにできないことと、できることは次のとおりです。',
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
    cautionHeading: '気をつけること',
    caution:
      '枠の中(全画面にしたときも)の表示は作者が作ったもので、別のサイトの画面に切り替わることもあります。そこにログイン画面が出ても、パスワードを入力しないでください。',
  },
  en: {
    helpHeading: 'Opening slides from someone you do not know',
    helpLead:
      'Slides are a program their author wrote, and they run in a frame inside the page. Here is what they cannot do, and what they can.',
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
    cautionHeading: 'Take care',
    caution:
      'What the frame shows, in full screen too, was made by the author, and it can switch to another site’s screen. If a sign-in screen appears there, do not type your password.',
  },
})

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
    <h3>${t.cautionHeading}</h3>
    <p>${t.caution}</p>
  </section>`
}
