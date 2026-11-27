import { html } from 'hono/html'
import { defineArticle } from '../../article'
import { SERVICE_NAME } from '../../../site/service'

export default defineArticle({
  order: 20,
  form: 'howto',
  related: ['account/edit-profile'],
  ja: {
    title: 'プロフィール画像を変える',
    lead: () =>
      html`プロフィール画像は、アップロードした画像、メールアドレスの Gravatar
      の画像、名前の頭文字の順に使われます。`,
    body: (n) =>
      html`<p>プロフィール画像は、次の順に使います。</p>
        <ol>
          <li>
            アップロードした画像。PNG、JPEG、WebP が使え、${n.pictureMb} MB
            までです。ブラウザの中で、中央を正方形に切り出して
            ${n.pictureSide}×${n.pictureSide}
            に縮めてから送るので、元の画像と、撮った場所などの情報は、${SERVICE_NAME}
            に届きません。スクリプトが動かないブラウザでは、変えられません。
          </li>
          <li>
            メールアドレスの Gravatar
            の画像。取るとき、メールアドレスから作った値(ハッシュ)を Gravatar
            を運営する Automattic(米国)に送ります(<a href="/privacy/external"
              >外部への送信</a
            >)。「Gravatar の画像を使う」を切ると、使いません。
          </li>
          <li>どちらもなければ、名前の頭文字。</li>
        </ol>
        <p>
          アップロードした画像は、「アップロードしたプロフィール画像を外す」でいつでも外せます。外すと、Gravatar
          の画像、なければ頭文字に戻ります。
        </p>`,
  },
  en: {
    title: 'Change your profile picture',
    lead: () =>
      html`Your profile picture is the image you upload, then your Gravatar
      picture, then your initial.`,
    body: (n) =>
      html`<p>The profile picture is taken in this order.</p>
        <ol>
          <li>
            An image you upload. PNG, JPEG and WebP work, up to ${n.pictureMb}
            MB. Your browser cuts a square from its middle and shrinks it to
            ${n.pictureSide} × ${n.pictureSide} before sending it, so the
            original and details such as where it was taken never reach
            ${SERVICE_NAME}. It cannot be changed in a browser with scripts
            turned off.
          </li>
          <li>
            The Gravatar picture of your email address. To get it, a value made
            from the address (a hash) is sent to Automattic (United States),
            which runs Gravatar (<a href="/privacy/external"
              >Transmissions to outside services</a
            >, in Japanese). Turn off “Use my Gravatar picture” to not use it.
          </li>
          <li>Failing both, the initial of your name.</li>
        </ol>
        <p>
          You can remove an uploaded image at any time with “Remove the uploaded
          profile picture”. The Gravatar picture, or else your initial, comes
          back.
        </p>`,
  },
})
