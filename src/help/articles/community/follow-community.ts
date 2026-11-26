import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 110,
  form: 'reference',
  related: ['community/create-community'],
  ja: {
    title: 'コミュニティをフォローする',
    lead: () =>
      html`コミュニティのページの「フォロー」を押すと、ログイン中のトップの「フォロー」のタブに、そのコミュニティに入った新しいスライドが並びます。`,
    body: () =>
      html`<p>
        新しいスライドが入ったときは、ヘッダーのベルのお知らせにも届きます(お知らせは、設定で受け取らないようにもできます)。「フォロー中」をもう一度押すと外れます。コミュニティがフォローされても、管理者へのお知らせはありません。
      </p>`,
  },
  en: {
    title: 'Follow a community',
    lead: (n) =>
      html`Press “Follow” on a community’s page, and new slides in it appear
      under “Following” on your top page while you are signed in.`,
    body: () =>
      html`<p>
        When a new slide comes into it, you are also told in the bell’s
        notifications (you can turn these off in the settings). Press
        “Following” again to stop. Nobody is told when a community is followed.
      </p>`,
  },
})
