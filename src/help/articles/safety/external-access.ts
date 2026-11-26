import { html } from 'hono/html'
import { defineArticle } from '../../article'
import { SERVICE_NAME } from '../../../site/service'

export default defineArticle({
  order: 10,
  form: 'reference',
  related: ['sharing/embed-in-blog', 'safety/block-user'],
  ja: {
    title: '知らない人のスライドを安全に開く',
    lead: () =>
      html`スライドはページの中の枠で動き、ブラウザが、ページ全体の移動や別のタブを開くことなどを許しません。`,
    body: () =>
      html`<p>スライドにできないことと、できることは次のとおりです。</p>
        <h2>スライドにできないこと</h2>
        <p>ブラウザは、スライドに次の操作をさせません。</p>
        <ul>
          <li>ページ全体を別のサイトへ移動させる</li>
          <li>別のタブやウィンドウを開く</li>
          <li>ファイルをダウンロードさせる</li>
          <li>ページを閉じたあとも動き続ける仕組みを残す</li>
          <li>${SERVICE_NAME} のログイン情報や管理画面に触れる</li>
        </ul>
        <h2>スライドにできること: 外部との通信</h2>
        <p>
          スライドは外部と通信できます。通信先には、あなたの IP
          アドレスと、そのスライドを開いたことが伝わります。枠の中であなたが入力した内容も、送ることができます。
        </p>
        <h2>気をつけること</h2>
        <p>
          枠の中(全画面にしたときも)の表示は作者が作ったもので、別のサイトの画面に切り替わることもあります。そこにログイン画面が出ても、パスワードを入力しないでください。
        </p>`,
  },
  en: {
    title: 'Open slides from someone you do not know safely',
    lead: () =>
      html`Slides run in a frame inside the page, and your browser does not let
      them send the whole page elsewhere or open other tabs.`,
    body: () =>
      html`<p>Here is what they cannot do, and what they can.</p>
        <h2>What slides cannot do</h2>
        <p>Your browser does not let slides do the following.</p>
        <ul>
          <li>Sending the whole page to another site</li>
          <li>Opening other tabs or windows</li>
          <li>Downloading files</li>
          <li>Leaving something that keeps running after you close the page</li>
          <li>Reaching your ${SERVICE_NAME} sign-in or dashboard</li>
        </ul>
        <h2>What slides can do: talk to other sites</h2>
        <p>
          Slides can talk to other sites. Those sites learn your IP address and
          that you opened the slides. Slides can also send what you type inside
          the frame.
        </p>
        <h2>Take care</h2>
        <p>
          What the frame shows, in full screen too, was made by the author, and
          it can switch to another site’s screen. If a sign-in screen appears
          there, do not type your password.
        </p>`,
  },
})
