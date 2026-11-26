import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 30,
  form: 'reference',
  related: ['slides/upload', 'slides/accepted-files'],
  ja: {
    title: '置ける大きさと本数の上限を知る',
    lead: () =>
      html`版の大きさ、ファイルの大きさ、ファイルの数、置けるスライドの本数には、上限があります。`,
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
    lead: () =>
      html`There are limits on the size of a version, the size of a file, the
      number of files and the number of slides.`,
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
