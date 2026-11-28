import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 120,
  form: 'reference',
  related: ['community/community-admins', 'community/ask-us'],
  ja: {
    title: 'コミュニティを削除する',
    lead: () =>
      html`管理者は、編集のページのいちばん下の「コミュニティを削除」で、ハンドルを入力して「削除する」を押すと、コミュニティを削除できます。`,
    body: (n) =>
      html`<p>
        コミュニティのページ、フォロー、紐づけ用リンクがなくなり、ハンドルは
        ${n.handleHoldDays}
        日の間、だれも使えません。スライドと関連リンクは残ります。コミュニティに入っていたことだけで出ていたリンクのページは、出なくなります。元に戻せません。
      </p>`,
  },
  en: {
    title: 'Delete a community',
    lead: () =>
      html`At the bottom of the edit page, under “Delete community”, an admin
      types the community’s handle and presses “Delete”.`,
    body: (n) =>
      html`<p>
        The community’s page, its follows and its links go away, and no one can
        take the handle for ${n.handleHoldDays} days. Slides and related links
        stay. A page of links that showed only because the community held the
        link stops showing. This cannot be undone.
      </p>`,
  },
})
