import { html } from 'hono/html'
import { defineArticle } from '../../article'
import { legalHref, PRIVACY_KEEPING } from '../../legal-links'

/** "1 day" or "2 days": the unit follows the number, which the code may change. */
const days = (count: number) => `${count} ${count === 1 ? 'day' : 'days'}`

export default defineArticle({
  order: 45,
  form: 'howto',
  related: [
    'account/export-slide',
    'slides/daily-limit',
    'sharing/read-offline',
  ],
  ja: {
    title: 'スライドを削除する',
    lead: () =>
      html`スライドの編集の画面のいちばん下にある「スライドを削除」の枠で、URL
      の末尾を入力して「スライドを削除」を押すと、共有 URL
      がすぐに読めなくなります。`,
    body: (n) =>
      html`<ol>
          <li>
            「スライドの管理」で、削除したいスライドの「編集する」を押します。
          </li>
          <li>
            スライドの編集の画面のいちばん下の「スライドを削除」の枠を開きます。
          </li>
          <li>
            「確認のため、URL
            の末尾」の欄に、欄の見出しに出ている名前を入力します。
          </li>
          <li>
            「スライドを削除」を押します。「スライドの管理」の一覧に戻り、そのスライドは一覧からなくなります。
          </li>
        </ol>
        <h2>削除すると</h2>
        <ul>
          <li>公開中の共有 URL は、すぐに読めなくなります。</li>
          <li>
            置いたすべての版のファイルと記録は、${n.deletedFilesHours}
            時間ほど後に消えます。
          </li>
          <li>そのスライドの記事と関連リンクは、すぐに消えます。</li>
          <li>
            元には戻せません。残したいときは、先に<a
              href="/help/account/export-slide"
              >スライドを zip で受け取る</a
            >でファイルを手元に置きます。
          </li>
          <li>
            1 人が置けるスライドの本数からは、すぐに外れます(<a
              href="/help/slides/limits"
              >置ける大きさと本数の上限を知る</a
            >)。登録したばかりの人の、新しく置ける本数には、削除しても数えられたままです(<a
              href="/help/slides/daily-limit"
              >「今日はこれ以上置けません」と出たとき</a
            >)。
          </li>
          <li>
            そのスライドを一度開いた読者の端末の保存は、読者が通信できるときにその
            URL を開くと消えます。通信できないあいだは、${n.offlineDays}
            日のあいだ読めることがあります(<a href="/help/sharing/read-offline"
              >通信が切れてもスライドを読む</a
            >)。
          </li>
          <li>
            バックアップに、消したあとも写しが残る期間は、プライバシーポリシーの<a
              href="${legalHref('privacy', PRIVACY_KEEPING)}"
              >「${PRIVACY_KEEPING}」</a
            >に書いてあります。
          </li>
        </ul>
        <h2>うまくいかないとき</h2>
        <ul>
          <li>
            入力した名前が違うと、「削除できませんでした」と出て、「入力したスライド名が一致しません。何も削除していません。」と表示されます。「スライドに戻る」を押して、欄の見出しに出ている名前をそのまま入力し直します。
          </li>
          <li>
            利用を止められているアカウントでは、スライドを 1
            つずつ削除する操作は使えません。
          </li>
          <li>
            それでも削除できないときは、<a href="/contact">お問い合わせ</a
            >ください。
          </li>
        </ul>`,
  },
  en: {
    title: 'Delete slides',
    lead: () =>
      html`At the bottom of the edit page, type the end of the URL in the frame
      “Delete these slides” and press “Delete slides”, and the share URL stops
      working at once.`,
    body: (n) =>
      html`<ol>
          <li>
            On “Your slides”, press “Edit” on the slides you want to delete.
          </li>
          <li>
            At the bottom of the edit page, find the frame “Delete these
            slides”.
          </li>
          <li>
            In the field “To confirm, type the end of the URL”, type the name
            shown in the field’s label.
          </li>
          <li>
            Press “Delete slides”. You are taken back to “Your slides”, and the
            slides are no longer in the list.
          </li>
        </ol>
        <h2>What deleting does</h2>
        <ul>
          <li>The public share URL stops working at once.</li>
          <li>
            The files and records of every version you put up are erased about
            ${n.deletedFilesHours} hours later.
          </li>
          <li>The slides’ article and related links go at once.</li>
          <li>
            It cannot be undone. If you want to keep them, first take the files
            out (<a href="/help/account/export-slide"
              >Take a slide out as a zip</a
            >).
          </li>
          <li>
            The slides stop counting toward the number one person may have at
            once (<a href="/help/slides/limits"
              >Know the limits on size and number</a
            >). For a new account’s limit on new slides, a deleted slide still
            counts (<a href="/help/slides/daily-limit"
              >When it says “You can't put up any more today”</a
            >).
          </li>
          <li>
            The copy a reader’s device kept of slides they opened once goes when
            the reader opens the URL with a connection. Without a connection, it
            may still be readable for ${days(n.offlineDays)} (<a
              href="/help/sharing/read-offline"
              >Read slides when you have no connection</a
            >).
          </li>
          <li>
            How long a copy stays in the backups after you delete is in the
            Privacy Policy, under its article on how long information is kept
            (<a href="${legalHref('privacy', PRIVACY_KEEPING)}"
              >Privacy Policy</a
            >). The text is in Japanese only.
          </li>
        </ul>
        <h2>If it does not work</h2>
        <ul>
          <li>
            If the name you type does not match, “Could not delete” appears with
            “The slide ID you typed does not match. Nothing was deleted.” Press
            “Back to the slides” and type the name shown in the label, exactly.
          </li>
          <li>
            An account whose use is stopped cannot delete slides one by one.
          </li>
          <li>
            If you still cannot delete them, <a href="/contact">contact us</a>.
          </li>
        </ul>`,
  },
})
