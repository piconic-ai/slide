import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 30,
  form: 'reference',
  related: ['safety/block-user'],
  ja: {
    title: 'ブロックとミュートの違いを知る',
    lead: () => html`ミュートとブロックの違いは、フォローです。`,
    body: () =>
      html`<p>
        ミュートも、相手のスライドをあなたの一覧から外し、相手からのお知らせを止めます。違いはフォローです。ミュートで外れるのは、あなたから相手へのフォローだけで、相手はあなたをフォローし続けられます。ブロックは互いのフォローを外し、相手はあなたをフォローできなくなります。ミュートの入口は
        viewer の「⋯」メニューだけで、ブロックは viewer
        とプロフィールの「⋯」メニューにあります。設定では、「ブロックしている人」と「ミュートしている人」の別の一覧に並びます。
      </p>`,
  },
  en: {
    title: 'Know how blocking differs from muting',
    lead: () => html`The difference between muting and blocking is following.`,
    body: () =>
      html`<p>
        Muting also takes their slides out of your lists and stops their
        notifications. The difference is following. Muting ends only your follow
        of them, and they can keep following you. Blocking ends both, and they
        can no longer follow you. You mute from the ⋯ menu of the viewer only;
        you block from that of the viewer or the profile. The settings list them
        apart, under “People you blocked” and “People you muted”.
      </p>`,
  },
})
