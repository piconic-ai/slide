import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 40,
  form: 'reference',
  related: ['community/follow-people'],
  ja: {
    title: 'フォローをやめる',
    lead: () =>
      html`自分のプロフィールの「フォロー中」で、解除したい人を選びます。`,
    body: () =>
      html`<p>
        相手のプロフィールやスライドの「フォロー中」のボタンからも解除できます。解除すると、相手のフォロワーの一覧からあなたが消え、新しいスライドのお知らせは届かなくなります。人をミュートしたとき、ブロックしたとき、退会したときも、フォローは外れます。
      </p>`,
  },
  en: {
    title: 'Stop following someone',
    lead: () => html`On your own profile, choose the person under “Following”.`,
    body: () =>
      html`<p>
        You can also unfollow from the “Following” button on their profile or
        slides. Then you disappear from their followers, and you no longer get
        notifications of their new slides. Muting or blocking someone, or
        leaving, also ends a follow.
      </p>`,
  },
})
