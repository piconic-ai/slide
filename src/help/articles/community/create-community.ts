import { html } from 'hono/html'
import { defineArticle } from '../../article'
import { SERVICE_NAME } from '../../../site/service'

export default defineArticle({
  order: 80,
  form: 'howto',
  related: [
    'community/link-rules',
    'community/community-admins',
    'community/list-event-talks',
  ],
  ja: {
    title: 'コミュニティを作る',
    lead: () =>
      html`勉強会やカンファレンスのページ(コミュニティ)を、ログインしている人ならだれでも作れます。`,
    body: (n) =>
      html`<p>
          紐づけ用リンクに合うイベントの発表が、自動でコミュニティのページに集まります。コミュニティは、人と同じ並びの
          <code>${SERVICE_NAME}/@ハンドル</code> の URL を持ちます。
        </p>

        <ol>
          <li>
            アカウントのメニューの<a href="/my/communities"
              >コミュニティの管理</a
            >の「コミュニティを作る」から、<a href="/communities/new"
              >コミュニティを作る</a
            >のページを開きます。イベントのページの「このグループのコミュニティはまだありません」の「作る」からも進めます。そのときは、紐づけ用リンクが入った状態で開きます。
          </li>
          <li>
            ハンドル、名前(${n.communityNameChars}
            文字まで)、紐づけ用リンクを入れて「作る」を押します。人やほかのコミュニティが使っているハンドルと、手放されてから
            ${n.handleHoldDays}
            日たっていないハンドルは使えません。ハンドルはあとから変えられません。
          </li>
          <li>
            作った人が管理者になり、コミュニティのページへ進みます。紐づけ用リンクに合う既存のイベントの発表が、すでに並んでいます。カバー画像とロゴは、5
            色から選ばれた色の既定の見た目になります。
          </li>
        </ol>`,
  },
  en: {
    title: 'Make a community',
    lead: () =>
      html`Anyone signed in can make a page for a meetup or a conference: a
      community.`,
    body: (n) =>
      html`<p>
          Talks given at events that match its links gather on the community’s
          page by themselves. A community has a URL of the form
          <code>${SERVICE_NAME}/@handle</code>, like a person.
        </p>

        <ol>
          <li>
            Open <a href="/communities/new">Create a community</a> from
            <a href="/my/communities">Your communities</a> in the account menu.
            You can also press “Create” under “This group has no community yet”
            on an event’s page, which opens it with the link filled in.
          </li>
          <li>
            Enter a handle, a name (up to ${n.communityNameChars} characters)
            and the links, and press “Create”. A handle in use by a person or
            another community, or let go less than ${n.handleHoldDays} days ago,
            cannot be taken. The handle cannot be changed later.
          </li>
          <li>
            You become its admin and go to the community’s page. Talks at
            existing events that match the links are already there. The cover
            and the logo take a default look in one of five colors.
          </li>
        </ol>`,
  },
})
