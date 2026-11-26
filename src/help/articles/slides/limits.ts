import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 30,
  form: 'reference',
  related: ['slides/upload', 'slides/accepted-files'],
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
        </p>`,
  },
})
