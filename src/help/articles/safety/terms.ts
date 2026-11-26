import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 40,
  form: 'reference',
  related: ['safety/privacy'],
  ja: {
    title: '利用規約を読む',
    lead: () => html`<a href="/terms">利用規約</a>を読めます。`,
    body: () =>
      html`<p>いまは仮のページで、正式な内容はまだ決めていません。</p>`,
  },
  en: {
    title: 'Read the Terms of Service',
    lead: () => html`You can read the <a href="/terms">Terms of Service</a>.`,
    body: () =>
      html`<p>
        It is a draft page for now, and the final text has not been decided.
      </p>`,
  },
})
