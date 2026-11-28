import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 70,
  form: 'reference',
  related: ['community/list-event-talks', 'articles/related-links'],
  ja: {
    title: 'スライドをイベントのリンクのページから外す',
    lead: () =>
      html`スライドの編集の画面の「関連リンク」で、そのリンクの「外す」を押します。`,
    body: () =>
      html`<p>そのスライドは、そのイベントのリンクのページから外れます。</p>`,
  },
  en: {
    title: 'Take slides off the page of an event’s link',
    lead: () =>
      html`Under “Related links” on the edit page, press “Remove” on the link.`,
    body: () => html`<p>The slides leave the page of that event’s link.</p>`,
  },
})
