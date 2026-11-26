import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 110,
  form: 'reference',
  related: ['community/create-community'],
  ja: {
    title: 'コミュニティをフォローする',
    lead: () =>
      html`コミュニティのページの「フォロー」を押すと、ログイン中のトップの「フォローコミュニティ」のタブに、そのコミュニティに入った新しいスライドが並びます。`,
    body: () => html`<p>「フォロー中」をもう一度押すと外れます。</p>`,
  },
  en: {
    title: 'Follow a community',
    lead: (n) =>
      html`Press “Follow” on a community’s page, and new slides in it appear
      under “Followed communities” on your top page while you are signed in.`,
    body: () => html`<p>Press “Following” again to stop.</p>`,
  },
})
