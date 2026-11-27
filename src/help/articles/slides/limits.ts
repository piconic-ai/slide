import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 30,
  form: 'reference',
  related: ['slides/upload', 'slides/accepted-files', 'slides/daily-limit'],
  ja: {
    title: '置ける大きさと本数の上限を知る',
    lead: (n) =>
      html`1 つの版は ${n.versionMb} MB、1 つのファイルは ${n.fileMb} MB、1
      つの版のファイルは ${n.files} 個、1 人が置けるスライドは ${n.decks}
      本までです。`,
    body: (n) =>
      html`<ul>
          <li>1 つの版は ${n.versionMb} MB まで</li>
          <li>1 つのファイルは ${n.fileMb} MB まで</li>
          <li>1 つの版のファイルは ${n.files} 個まで</li>
          <li>1 人が置けるスライドは ${n.decks} 本まで</li>
          <li>1 人が置けるファイルの合計は ${n.authorMb} MB まで</li>
        </ul>
        <p>
          ブラウザから置くときは、版の大きさ、ファイルの大きさ、ファイルの数を、送る前に確かめます。超えているときは、どの上限を超えたかを枠の中に出します。
        </p>
        <h2>登録したばかりの人の上限</h2>
        <p>
          登録から ${n.newAuthorDays}
          日のあいだは、新しく置き始められるスライドが、直近
          ${n.newAuthorWindowHours} 時間に ${n.newAuthorPerDay}
          本までです。新しい版への差し替えは数えません。上限に達すると「今日はこれ以上置けません」と出ます(<a
            href="/help/slides/daily-limit"
            >「今日はこれ以上置けません」と出たとき</a
          >)。
        </p>`,
  },
  en: {
    title: 'Know the limits on size and number',
    lead: (n) =>
      html`A version may be up to ${n.versionMb} MB, a file up to ${n.fileMb}
      MB, a version may have up to ${n.files} files, and one person may have up
      to ${n.decks} slides.`,
    body: (n) =>
      html`<ul>
          <li>One version: up to ${n.versionMb} MB</li>
          <li>One file: up to ${n.fileMb} MB</li>
          <li>Files in one version: up to ${n.files}</li>
          <li>Slides per person: up to ${n.decks}</li>
          <li>All files per person together: up to ${n.authorMb} MB</li>
        </ul>
        <p>
          When you drop in the browser, the size of the version, the size of
          each file and the number of files are checked before anything is sent.
          If one is over, the drop area says which limit it is.
        </p>
        <h2>The limit for a new account</h2>
        <p>
          For the first ${n.newAuthorDays} days after you register, you can
          start up to ${n.newAuthorPerDay} new slides in any
          ${n.newAuthorWindowHours} hours. Putting a new version on a slide you
          already have does not count. When you reach the limit, it says “You
          can't put up any more today” (<a href="/help/slides/daily-limit"
            >When it says “You can't put up any more today”</a
          >).
        </p>`,
  },
})
