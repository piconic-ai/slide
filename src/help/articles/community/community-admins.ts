import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 100,
  form: 'reference',
  related: ['community/create-community', 'community/delete-community'],
  ja: {
    title: 'コミュニティを管理する',
    lead: () =>
      html`管理者は、「コミュニティを編集」から、名前、説明、画像、リンクを直せ、ほかの人を管理者に足せます。`,
    body: (n) =>
      html`<ul>
        <li>
          管理者は、コミュニティのページの「コミュニティを編集」から、名前、説明(${n.communityDescriptionChars}
          文字まで)、ロゴ(${n.logoMb} MB まで)、カバー画像(${n.coverMb} MB
          まで)、ほかのリンク(${n.communitySites}
          つまで)、紐づけ用リンク、そのコミュニティのイベント名を直せます。画像は
          PNG、JPEG、WebP です。
        </li>
        <li>
          管理者は、ハンドルで別の人を管理者に足せます。ほかの管理者を外すことも、自分が外れることもできます。最後の
          1 人は外れられません。
        </li>
        <li>
          管理者は、コミュニティに入ったスライドやフォロワーを外せません。
        </li>
        <li>
          自分が管理しているコミュニティは、設定の「管理しているコミュニティ」に並びます。
        </li>
      </ul>`,
  },
  en: {
    title: 'Manage a community',
    lead: () =>
      html`An admin can fix the name, the description, the images and the links
      in “Edit community”, and add other admins.`,
    body: (n) =>
      html`<ul>
        <li>
          From “Edit community” on the community’s page, admins can change its
          name, its description (up to ${n.communityDescriptionChars}
          characters), its logo (up to ${n.logoMb} MB), its cover image (up to
          ${n.coverMb} MB), its other links (up to ${n.communitySites}), its
          links that gather slides, and the names of its events. Images are PNG,
          JPEG or WebP.
        </li>
        <li>
          An admin can add another person as an admin by their handle, remove
          other admins, and stop being one. The last admin cannot leave.
        </li>
        <li>Admins cannot remove slides or followers from the community.</li>
        <li>
          The communities you run are listed under “Communities you run” in the
          settings.
        </li>
      </ul>`,
  },
})
