import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 50,
  form: 'reference',
  related: ['safety/terms', 'account/email-privacy'],
  ja: {
    title: 'プライバシーポリシーを読む',
    lead: () => html`<a href="/privacy">プライバシーポリシー</a>を読めます。`,
    body: () =>
      html`<p>いまは仮のページで、正式な内容はまだ決めていません。</p>`,
  },
  en: {
    title: 'Read the Privacy Policy',
    lead: () => html`You can read the <a href="/privacy">Privacy Policy</a>.`,
    body: () =>
      html`<p>
        It is a draft page for now, and the final text has not been decided.
      </p>`,
  },
})
