import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 20,
  form: 'reference',
  related: ['articles/write', 'agent/write-article-draft'],
  ja: {
    title: '記事を公開する、公開を止める',
    lead: () =>
      html`公開する前の記事は下書きで、作者だけが viewer で確かめられます。`,
    body: () =>
      html`<ul>
        <li>
          公開する前は、下書きです。自動で保存され、作者だけが、viewer
          でそのまま確かめられます。
        </li>
        <li>
          スライドの編集の画面の「記事」の枠で「記事を公開する」を押すと、スライドが一般公開されている間だけ、viewer
          のスライドの下に載ります(編集の画面の入力欄ではなく、保存済みの本文が公開されます)。
        </li>
        <li>
          公開したあとに直した内容は、「編集中の下書き」として自動で保存されますが、「公開記事を更新」を押すまで、読者には見えません。編集中の下書きがあるときは、「未反映の変更あり」と出ます。
        </li>
        <li>
          「変更を取り消す」を押すと、編集中の下書きを捨てて、公開中の本文に戻ります。スライドの編集の画面の「記事の公開を止める」を押すと、保存済みの本文(編集中の下書きがあればそれ)が下書きの本文になります。
        </li>
      </ul>`,
  },
  en: {
    title: 'Publish an article, or stop publishing it',
    lead: () =>
      html`An article is a draft until you publish it, and only the author can
      check it in the viewer.`,
    body: (n) =>
      html`<ul>
        <li>
          Before it is published, it is a draft. It is saved by itself, and only
          you see it in the viewer, as readers would.
        </li>
        <li>
          Press “Publish the article” in the “Article” area of the slide’s edit
          page, and it appears under the slides in the viewer for as long as the
          slides are public (what is kept is published, not the box of the
          article page).
        </li>
        <li>
          What you change after publishing is saved by itself as an edit of its
          own, but readers do not see it until you press “Update published
          article”. While there is such an edit, “Changes not shown yet” is
          shown.
        </li>
        <li>
          “Undo changes” drops the edit and brings back the published text.
          “Stop publishing the article” on the slide’s edit page turns it into a
          draft holding the text that was kept (the edit, if there is one).
        </li>
      </ul>`,
  },
})
