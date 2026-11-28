import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 20,
  form: 'howto',
  related: ['safety/block-vs-mute', 'community/follow-people'],
  ja: {
    title: '人をブロックする',
    lead: () =>
      html`困った相手をブロックすると、その人はあなたをフォローできなくなり、その人のスライドと引用が、あなたの画面とお知らせから消えます。`,
    body: () =>
      html`<p>相手には知らされません。</p>
        <h2>ブロックのしかた</h2>

        <ol>
          <li>
            相手のスライドの viewer
            の「⋯」メニューの「この作者をブロック」か、相手のプロフィールの「⋯」メニューの「この人をブロック」を選びます。ログインが必要です。自分自身はブロックできません。
          </li>
          <li>確認のページで効き目を読み、「ブロックする」を押します。</li>
        </ol>
        <h2>効き目</h2>

        <ul>
          <li>
            互いのフォローが外れ、相手はあなたをフォローできなくなります。
          </li>
          <li>
            相手のスライドが、あなたのトップ、おすすめ、コミュニティとリンクのページの一覧と数、フォローしているコミュニティの新着に出なくなります。
          </li>
          <li>
            相手のスライドや記事にあなたのスライドへのリンクがあっても、あなたの画面には引用として出ず、お知らせも届かず、「引用された」の数にも入りません。リンクを書くこと自体は止められません。
          </li>
          <li>
            相手の公開中のスライドは、URL
            を直接開けば、ログインしていない人と同じく見られます。
          </li>
          <li>コミュニティのフォローは止まりません。</li>
          <li>
            ブロックしたことは、相手に知らせません。相手が見るあなたのプロフィールでは「フォロー」が押せず、「この人はフォローできません。」とだけ出ます。
          </li>
        </ul>
        <h2>解除のしかた</h2>

        <p>
          設定の「ブロックしている人」で、相手の「ブロックを解除」を押します。解除すると、相手のスライドと引用が、またあなたの画面に出ます。外れたフォローは戻りません。
        </p>`,
  },
  en: {
    title: 'Block someone',
    lead: () =>
      html`Block someone who troubles you, and they can no longer follow you,
      and their slides and citations go from your pages and notifications.`,
    body: (n) =>
      html`<p>They are not told.</p>
        <h2>How to block</h2>

        <ol>
          <li>
            Choose “Block this author” in the ⋯ menu of the viewer of their
            slides, or “Block this person” in the ⋯ menu of their profile. You
            need to be signed in. You cannot block yourself.
          </li>
          <li>
            Read what blocking does on the page that asks, and press “Block”.
          </li>
        </ol>
        <h2>What it does</h2>

        <ul>
          <li>
            You stop following each other, and they can no longer follow you.
          </li>
          <li>
            Their slides no longer appear on your top page, in recommendations,
            in the lists and counts of community pages and pages of links, or
            among new slides of the communities you follow.
          </li>
          <li>
            When their slides or articles link to yours, you do not see them as
            citations, get no notification, and they are not counted under
            “Cited”. The links themselves cannot be stopped.
          </li>
          <li>
            Their public slides still open, as for anyone signed out, when you
            go to the URL.
          </li>
          <li>Community follows stay as they are.</li>
          <li>
            They are not told that you blocked them. When they open your
            profile, their “Follow” cannot be pressed, and it only says “You
            can’t follow this person.”
          </li>
        </ul>
        <h2>How to unblock</h2>

        <p>
          Under “People you blocked” in the settings, press “Unblock” for them.
          Their slides and citations appear to you again. Follows that ended do
          not come back.
        </p>`,
  },
})
