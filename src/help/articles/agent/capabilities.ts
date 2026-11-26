import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 20,
  form: 'reference',
  related: ['agent/connect', 'agent/write-article-draft'],
  ja: {
    title: 'AI エージェントにできること、できないことを知る',
    lead: () =>
      html`AI
      エージェントは、スライドを置き、記事の下書きを書けますが、公開と削除はできません。`,
    body: (n) =>
      html`<h2>エージェントにできること</h2>

        <ul>
          <li>自分のスライドの一覧を見る</li>
          <li>新しく置く</li>
          <li>
            新しい版に差し替える(公開中の版は、人が入れ替えるまで変わりません)
          </li>
          <li>受け取りの状態を見る</li>
          <li>
            記事を読み、下書きを書く(公開は、人が行います。公開中の記事に書いたものは編集中の下書きに入り、「公開記事を更新」を押すまで読者には見えません。本文は
            ${n.articleChars} 文字までです)
          </li>
          <li>
            関連リンクを足す、外す(<code>https://</code> の URL を、1 本に
            ${n.maxLinks} 件まで)
          </li>
        </ul>
        <p>
          小さな HTML(文字のファイルの合計が ${n.agentMb} MB
          まで)は、道具の引数で渡します。それより大きいもの、画像などを含むものは、エージェントが送り先へ直接送ります。zip
          は渡せません。ファイルの一覧(パスと内容)で渡します。上限は、ブラウザから置くときと同じ(1
          つの版 ${n.versionMb} MB、1 つのファイル ${n.fileMb} MB、${n.files}
          ファイル、1 人 ${n.decks}
          本)です。${n.invitationOnly ? '招待制も同じです。' : ''}
        </p>
        <h2>エージェントにできないこと</h2>

        <p>
          スライドや記事を公開すること、公開を止めること、削除すること、URL
          の名前を変えること、設定を変えることはできません。置かれたスライドは、あなたがスライドの編集の画面で「公開する」を押すまで、自分だけが見られます。
        </p>`,
  },
  en: {
    title: 'Know what an AI agent can and cannot do',
    lead: () =>
      html`An AI agent can put up slides and write article drafts, but it cannot
      publish or delete.`,
    body: (n) =>
      html`<h2>What the agent can do</h2>

        <ul>
          <li>List your slides</li>
          <li>Put new slides up</li>
          <li>
            Replace slides with a new version (the public version does not
            change until a person replaces it)
          </li>
          <li>Check the state of an upload</li>
          <li>
            Read an article and write a draft of it (a person publishes it; on a
            published article it goes into the working draft, which readers do
            not see until “Update published article” is pressed; the text can
            have up to ${n.articleChars} characters)
          </li>
          <li>
            Add or remove related links (<code>https://</code> URLs, up to
            ${n.maxLinks} per slide)
          </li>
        </ul>
        <p>
          Small HTML (up to ${n.agentMb} MB of text files together) is passed in
          the tool’s arguments. Anything larger, or with images and the like,
          the agent sends directly to an address it is given. A zip cannot be
          passed; files go as a list of paths and contents. The limits are the
          same as when you put slides up from the browser (a version
          ${n.versionMb} MB, a file ${n.fileMb} MB, ${n.files} files, ${n.decks}
          slides per person).${n.invitationOnly ? ' So is the invitation.' : ''}
        </p>
        <h2>What the agent cannot do</h2>

        <p>
          It cannot publish slides or articles, stop publishing, delete, rename
          the URL or change settings. Slides it puts up are visible only to you
          until you press “Publish” on the edit page.
        </p>`,
  },
})
