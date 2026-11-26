import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 30,
  form: 'reference',
  related: ['community/unfollow', 'safety/block-user'],
  ja: {
    title: '人をフォローする',
    lead: () =>
      html`気になる人をフォローすると、その人が新しいスライドを公開したときに知らせが届きます(お知らせは、設定で受け取らないようにもできます)。`,
    body: (n) =>
      html`<h2>フォローすると</h2>

        <ul>
          <li>
            相手のプロフィールか、スライドの作者名のそばの「フォロー」を押します。ログインが必要です。自分自身はフォローできません。
          </li>
          <li>
            相手が新しいスライドを公開すると、ヘッダーのベルのお知らせに届き、トップの「フォロー」のタブに、公開が新しい順に並びます(最初は
            ${n.followingShown} 件。「もっと見る」で続きを ${n.moreStep}
            件ずつ読めます)。
          </li>
          <li>
            相手には、あなたがフォローしたことが、お知らせで伝わります(相手が設定で止めていなければ)。
          </li>
        </ul>
        <h2>一覧</h2>

        <p>
          プロフィールの「フォロー中」と「フォロワー」の一覧と、その数は、ログインしていない人を含めて、だれでも見られます。あなたがミュートしている人は、あなたが見る一覧に出ません。停止中の人と退会した人は、だれが見ても出ません。
        </p>`,
  },
  en: {
    title: 'Follow people',
    lead: () =>
      html`When you follow someone, you are told when they publish new slides
      (you can turn these notifications off in the settings).`,
    body: (n) =>
      html`<h2>When you follow</h2>

        <ul>
          <li>
            Press “Follow” on their profile or beside the author’s name on their
            slides. You need to be signed in. You cannot follow yourself.
          </li>
          <li>
            When they publish new slides, it arrives in the bell’s notifications
            and shows in the “Following” tab of your top page, newest first (the
            first ${n.followingShown} at once; “Show more” reads on,
            ${n.moreStep} at a time).
          </li>
          <li>
            They are notified that you followed them (unless they turned that
            off in the settings).
          </li>
        </ul>
        <h2>The lists</h2>

        <p>
          The “Following” and “Followers” lists on a profile, and their counts,
          can be seen by anyone, including people who are not signed in. People
          you muted do not appear in the lists you see. Suspended people and
          people who left never appear to anyone.
        </p>`,
  },
})
