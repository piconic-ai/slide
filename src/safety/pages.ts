import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'
import { PAGES_SHOWN, type TrafficRow, type TrafficSummary } from './summary'
import type { Kind } from './traffic'

/** Where the help page explains what holds for every slide. */
export const SAFETY_HELP_PATH = '/help#safety'
/** Where the help page explains how to read the table. */
export const TRAFFIC_HELP_PATH = '/help#traffic'

const text = messages({
  ja: {
    summary: '外部との通信',
    page: 'ページ',
    what: '何をしているか',
    where: 'どの URL に',
    kinds: {
      script: 'プログラムの読み込み',
      style: 'スタイルシートの読み込み',
      image: '画像の読み込み',
      font: 'フォントの読み込み',
      data: 'データの送受信',
      frame: '外部サイトの埋め込み',
      media: '音声・動画の読み込み',
      other: 'その他の通信',
    } satisfies Record<Kind, string>,
    opening: '全体',
    unknown: '不明',
    others: (count: number, full: boolean) =>
      full ? `ほか ${count} 件以上` : `ほか ${count} 件`,
    more: 'このほかにも報告されています。',
    none: '外部との通信は、まだ報告されていません。',
    failed: '表を読み込めませんでした。開き直すと、もう一度読み込みます。',
    help: 'この表の読み方',
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
    listHeading: '「外部との通信」の表の読み方',
    listNote:
      'スライドのページにある「外部との通信」は、読者のブラウザからの報告をまとめた表です。どのページで、何をしていて、どの URL と通信したかを並べます。URL は path までで、「?」より後ろは保存しません。同じ相手との同じ種類の通信は 1 行にまとめ、残りは件数だけを示します。「全体」は、スライドを開いたときに起きた通信です。',
    listLimit:
      '誰でも報告を送れるので、正確とは限りません。報告されていない通信があることもあります。「まだ報告されていません」は、通信しないことを示すものではありません。',
    cautionHeading: '気をつけること',
    caution:
      '枠の中(全画面にしたときも)の表示は作者が作ったもので、別のサイトの画面に切り替わることもあります。そこにログイン画面が出ても、パスワードを入力しないでください。',
  },
  en: {
    summary: 'Traffic to other sites',
    page: 'Page',
    what: 'What it does',
    where: 'To which URL',
    kinds: {
      script: 'Loads a program',
      style: 'Loads a style sheet',
      image: 'Loads an image',
      font: 'Loads a font',
      data: 'Sends or receives data',
      frame: 'Embeds another site',
      media: 'Loads audio or video',
      other: 'Other traffic',
    } satisfies Record<Kind, string>,
    opening: 'All',
    unknown: 'Unknown',
    others: (count: number, full: boolean) =>
      full ? `and ${count} or more others` : `and ${count} more`,
    more: 'More than this has been reported.',
    none: 'No traffic to other sites has been reported yet.',
    failed: 'The table could not be read. Open it again to retry.',
    help: 'How to read this table',
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
    listHeading: 'How to read “Traffic to other sites”',
    listNote:
      '“Traffic to other sites” on a slide page is a table of what readers’ browsers have reported: on which page, what the slides did, and with which URL. A URL is kept up to its path; anything after “?” is not stored. Traffic of one kind with one site makes one row, and the rest is only counted. “All” is traffic from when the slides opened.',
    listLimit:
      'Anyone can send a report, so the table may be wrong, and some traffic may be missing. “No traffic to other sites has been reported yet” does not show the slides send none.',
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
  .traffic {
    border-collapse: collapse;
    width: 100%;
  }
  .traffic th,
  .traffic td {
    padding: 4px 12px 4px 0;
    text-align: left;
    vertical-align: top;
    font-weight: normal;
  }
  .traffic th {
    color: #555;
    white-space: nowrap;
  }
  .traffic td:first-child {
    white-space: nowrap;
  }
  .traffic code {
    overflow-wrap: anywhere;
  }`

const pagesOf = (row: TrafficRow, t: (typeof text)[Lang]) => {
  const shown = [
    ...(row.opening ? [t.opening] : []),
    ...row.pages.slice(0, PAGES_SHOWN),
  ]
  if (shown.length === 0) return t.unknown
  return row.pages.length > PAGES_SHOWN
    ? `${shown.join(', ')}, …`
    : shown.join(', ')
}

/**
 * The facts about one version's traffic: on which page, what the slides
 * did, and with which URL. No row is marked as better or worse than another.
 */
export function trafficTable(summary: TrafficSummary, lang: Lang) {
  const t = text[lang]
  if (summary.rows.length === 0) return html`<p>${t.none}</p>`
  return html`<table class="traffic">
      <thead>
        <tr>
          <th scope="col">${t.page}</th>
          <th scope="col">${t.what}</th>
          <th scope="col">${t.where}</th>
        </tr>
      </thead>
      <tbody>
        ${summary.rows.map(
          (row) =>
            html`<tr>
              <td>${pagesOf(row, t)}</td>
              <td>${t.kinds[row.kind]}</td>
              <td>
                <code>${row.host}${row.path}</code>
                ${row.others > 0 ? t.others(row.others, row.full) : ''}
              </td>
            </tr>`,
        )}
      </tbody>
    </table>
    ${summary.more ? html`<p>${t.more}</p>` : ''}`
}

/**
 * Where a reader opens the table for the slides on screen. The viewer's
 * script reads the table from `trafficUrl` each time it is opened: reports
 * arrive while slides run. What holds for every slide is on the help page
 * this links to, in another tab so the slides keep running.
 */
export function safetySection(trafficUrl: string, lang: Lang) {
  const t = text[lang]
  return html`<details class="safety" data-traffic="${trafficUrl}">
    <summary>${t.summary}</summary>
    <div data-traffic-table></div>
    <p data-traffic-failed hidden>${t.failed}</p>
    <p>
      <a href="${TRAFFIC_HELP_PATH}" target="_blank" rel="noopener"
        >${t.help}</a
      >
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
    <h3 id="traffic">${t.listHeading}</h3>
    <p>${t.listNote}</p>
    <p>${t.listLimit}</p>
    <h3>${t.cautionHeading}</h3>
    <p>${t.caution}</p>
  </section>`
}
