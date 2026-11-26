import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 10,
  form: 'reference',
  related: ['articles/publish', 'articles/markdown', 'articles/embed-page'],
  ja: {
    title: '記事を書く',
    lead: () =>
      html`スライドの下に、発表の書き起こしなどの記事を載せられます。`,
    body: (n) =>
      html`<p>
          記事は、スライドを置いた作者だけが書けます。スライド 1
          本につき、記事は 1 本です。
        </p>
        <h2>書く場所</h2>

        <p>
          スライドの編集の画面の「記事」の枠から「記事を書く」(書いたあとは「記事を編集する」)を押すと、記事の編集のページが開きます。入力欄に
          Markdown
          を書きます。画面の上の「ビューアーで見る」を押すと、保存する前の本文で、読者と同じ表示が開きます(「編集に戻る」で、書いていた本文のまま戻れます)。本文は
          ${n.articleChars} 文字までです。
        </p>
        <h2>自動保存</h2>

        <p>
          入力して 1.5
          秒ほど待つと、本文は自動で保存されます。入力欄の下に、「保存しました(時刻)」のように状態が出ます。保存できなかったときも、入力は消えず、もう一度試します。自動保存が済んでいない間にページを離れようとすると、確認が出ます。
        </p>`,
  },
  en: {
    title: 'Write an article',
    lead: () =>
      html`You can put an article, such as a transcript of your talk, under the
      slides.`,
    body: (n) =>
      html`<p>
          Only the author of the slides can write it. Each slide has at most one
          article.
        </p>
        <h2>Where to write</h2>

        <p>
          On the edit page of the slides, press “Write the article” (afterwards
          “Edit the article”) in the “Article” area to open the article page.
          Type Markdown in the box. “View in viewer” at the top opens the page
          as readers will see it, drawn from the text you have not saved yet
          (“Back to editing” returns with the text as it was). The text can have
          up to ${n.articleChars} characters.
        </p>
        <h2>Autosave</h2>

        <p>
          About 1.5 seconds after you stop typing, the text is saved by itself.
          Under the box you see the state, such as “Saved (12:34)”. If saving
          fails, what you typed stays and it is tried again. If you try to leave
          while a save is not done, you are asked first.
        </p>`,
  },
})
