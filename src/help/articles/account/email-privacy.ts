import { html } from 'hono/html'
import { defineArticle } from '../../article'
import { SERVICE_NAME } from '../../../site/service'

export default defineArticle({
  order: 30,
  form: 'reference',
  related: ['account/edit-profile', 'safety/privacy'],
  ja: {
    title: 'メールアドレスがほかの人に見えるか確かめる',
    lead: () => html`メールアドレスは、ほかの人には見えません。`,
    body: () =>
      html`<p>
        Gravatar の画像も、${SERVICE_NAME}
        が取ってきて配るので、ページにはメールアドレスも、そこから作った値も出ません。
      </p>`,
  },
  en: {
    title: 'Check who can see your email address',
    lead: () => html`Nobody else can see your email address.`,
    body: () =>
      html`<p>
        ${SERVICE_NAME} fetches and serves the Gravatar picture itself, so no
        page shows the address or anything made from it.
      </p>`,
  },
})
