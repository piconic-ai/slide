import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 20,
  form: 'reference',
  related: ['start/sign-in'],
  // About an invitation, so it is left out while sign-up is open (F42-AC5).
  onlyWhile: 'invitation',
  ja: {
    title: '招待されているか確かめる',
    lead: () => html`運営が登録したメールアドレスでだけ、ログインできます。`,
    body: () =>
      html`<p>
        登録されていないアドレスを入れても、画面は同じ「コードを送りました」になりますが、コードは届きません。ログインできた人は、全員スライドを置けます。
      </p>`,
  },
  en: {
    title: 'Check whether you are invited',
    lead: (n) =>
      html`Only email addresses the operators registered can sign in.`,
    body: () =>
      html`<p>
        If you enter one that is not registered, the screen still says the code
        was sent, but no code arrives. Everyone who can sign in can put slides
        up.
      </p>`,
  },
})
