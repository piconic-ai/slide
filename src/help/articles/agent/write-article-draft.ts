import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 40,
  form: 'reference',
  related: ['agent/connect', 'articles/publish'],
  ja: {
    title: 'AI エージェントに記事の下書きを書いてもらう',
    lead: () =>
      html`MCP につないだ AI エージェントは、記事を読んで、下書きを書けます。`,
    body: () =>
      html`<p>
          つなぎかたは、<a href="/help/agent/connect">AI エージェントをつなぐ</a
          >を読んでください。
        </p>
        <p>
          公開はできません。公開中の記事に書いたものは、編集中の下書きに入り、あなたが「公開記事を更新」を押すまで読者には見えません。エージェントが書いたあとに、開いたままの編集のページで続けて書こうとすると、「別のタブで更新されています」と出ます。再読み込みすると、エージェントが書いた本文になります。
        </p>`,
  },
  en: {
    title: 'Have an AI agent write an article draft',
    lead: () =>
      html`An AI agent connected by MCP can read the article and write a draft
      of it.`,
    body: () =>
      html`<p>
          To connect one, read
          <a href="/help/agent/connect">Connect an AI agent</a>.
        </p>
        <p>
          It cannot publish. What it writes on a published article goes into the
          working draft, and readers do not see it until you press “Update
          published article”. If the article page is still open from before the
          agent wrote, it says “It was updated in another tab”; reload it to get
          the agent’s text.
        </p>`,
  },
})
