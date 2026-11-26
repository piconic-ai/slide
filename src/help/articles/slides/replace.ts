import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 40,
  form: 'reference',
  related: ['slides/upload', 'slides/url-name'],
  ja: {
    title: 'スライドを差し替える',
    lead: () =>
      html`直した版は、スライドの編集の画面の「新しい版」にドロップします。`,
    body: () =>
      html`<p>
        共有 URL
        は変わりません。公開中の版は、「新しい版」の行の「この版を公開する」を押すまで変わらないので、発表中に差し替えても、読者に見える版は動きません。
      </p>`,
  },
  en: {
    title: 'Replace slides',
    lead: () => html`Drop the fixed version on “New version” on the edit page.`,
    body: () =>
      html`<p>
        The share link stays the same. The public version does not change until
        you press “Publish this version” on the row of the new version, so
        replacing slides in the middle of a talk does not move what readers see.
      </p>`,
  },
})
