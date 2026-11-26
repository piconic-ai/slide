import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 70,
  form: 'reference',
  related: ['community/list-event-talks', 'articles/related-links'],
  ja: {
    title: 'スライドをイベントのページから外す',
    lead: () =>
      html`スライドの編集の画面の「関連リンク」で、そのリンクの「外す」を押すか、種類を「イベント」からほかの種類に変えて「保存する」を押します。`,
    body: () => html`<p>そのスライドは、イベントのページから外れます。</p>`,
  },
  en: {
    title: 'Take slides off an event’s page',
    lead: () =>
      html`Under “Related links” on the edit page, press “Remove” on the link,
      or change its kind from Event to another and press “Save”.`,
    body: () => html`<p>The slides leave the event’s page.</p>`,
  },
})
