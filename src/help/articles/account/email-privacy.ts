import { html } from 'hono/html'
import { defineArticle } from '../../article'
import { SERVICE_NAME } from '../../../site/service'

export default defineArticle({
  order: 30,
  form: 'reference',
  related: ['account/edit-profile', 'safety/privacy', 'safety/data-we-keep'],
  ja: {
    title: 'メールアドレスがほかの人に見えるか確かめる',
    lead: () => html`メールアドレスは、ほかの利用者には見えません。`,
    body: () =>
      html`<p>
          Gravatar の画像も、${SERVICE_NAME}
          が取ってきて配るので、ページにはメールアドレスも、そこから作った値も出ません。
        </p>
        <p>
          運営は、招待の一覧で、招待したアドレスを読みます。メールアドレスは、${SERVICE_NAME}
          のデータベースに、そのままの形で預かっています(<a
            href="/help/safety/data-we-keep"
            >預かっている情報と、その守り方</a
          >)。
        </p>
        <p>
          顔写真を登録していない人の既定の画像を Gravatar
          から取るとき、メールアドレスから作った値(ハッシュ)を、Gravatar
          を運営する Automattic(米国)に送ります。「Gravatar
          の画像を使う」を切ると、使いません。くわしくは<a
            href="/privacy/external"
            >外部への送信</a
          >を読んでください。
        </p>`,
  },
  en: {
    title: 'Check who can see your email address',
    lead: () => html`Other users cannot see your email address.`,
    body: () =>
      html`<p>
          ${SERVICE_NAME} fetches and serves the Gravatar picture itself, so no
          page shows the address or anything made from it.
        </p>
        <p>
          The operator reads the addresses it invited in its invitation list.
          Your address is kept as plain text in ${SERVICE_NAME}’s database (<a
            href="/help/safety/data-we-keep"
            >what we keep, and how we protect it</a
          >).
        </p>
        <p>
          When the default picture of someone who has not set a photo is taken
          from Gravatar, a value made from the email address (a hash) is sent to
          Automattic (United States), which runs Gravatar. Turning off “Use my
          Gravatar picture” stops using it. See
          <a href="/privacy/external">Transmissions to outside services</a> (in
          Japanese).
        </p>`,
  },
})
