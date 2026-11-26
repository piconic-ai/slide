import { html } from 'hono/html'
import { profilePath } from '../share/path'
import { messages, type Lang } from '../site/i18n'
import { prefixedField } from '../site/prefixed-field'
import type { AdminNotice } from './admin-notice'
import type { CommunityAdmin } from './admin-store'
import { communityActionPath, type Community } from './community'

const text = messages({
  ja: {
    admins: '管理者',
    adminsNote:
      'このコミュニティを編集できる人。最初は作った人です。管理者はだれでも、ほかの管理者を足したり外したりできます。',
    leave: '管理者から外れる',
    lastAdmin:
      '最後の管理者は外れられません。ほかの管理者を足してから外れてください。',
    remove: '外す',
    removeLabel: (handle: string) => `@${handle} を管理者から外す`,
    add: '管理者を足す(ハンドル)',
    addButton: '足す',
    scope:
      'ここで変えられるのは見た目と説明、紐づけ用リンク、管理者、コミュニティの削除です。スライドやフォロワーを外す権限はありません。もめたときは、お問い合わせを受けてサービスの運営が直します。',
    delete: 'コミュニティを削除',
    deleteNote:
      'コミュニティのページとハンドルがなくなります。スライドとイベントのページは残ります。元に戻せません。',
    deleteConfirm: (handle: string) =>
      `確認のため、このコミュニティのハンドル ${handle} を入力してください`,
    deleteButton: '削除する',
    notices: {
      'admin-added': '管理者を足しました。',
      'admin-already': 'その人は、すでに管理者です。',
      'admin-unknown': 'そのハンドルの人が見つかりません。',
      'admin-removed': '管理者から外しました。',
      'admin-last':
        '最後の管理者は外れられません。先に別の人を管理者に足すか、コミュニティを削除してください。',
      'delete-mismatch':
        '入力したハンドルが一致しません。何も削除していません。',
    } satisfies Record<AdminNotice, string>,
  },
  en: {
    admins: 'Admins',
    adminsNote:
      'The people who can edit this community; first, the one who made it. Any admin can add or remove other admins.',
    leave: 'Stop being an admin',
    lastAdmin: 'The last admin cannot leave. Add another admin before leaving.',
    remove: 'Remove',
    removeLabel: (handle: string) => `Remove @${handle} as an admin`,
    add: 'Add an admin (handle)',
    addButton: 'Add',
    scope:
      'Here you can change how it looks, its description, its links, its admins, and delete it. Admins cannot remove slides or followers. When there is trouble, the service fixes it on request.',
    delete: 'Delete community',
    deleteNote:
      'The community’s page and handle go away. Slides and event pages stay. This cannot be undone.',
    deleteConfirm: (handle: string) =>
      `To confirm, type this community’s handle, ${handle}`,
    deleteButton: 'Delete',
    notices: {
      'admin-added': 'The admin was added.',
      'admin-already': 'That person is already an admin.',
      'admin-unknown': 'No person has that handle.',
      'admin-removed': 'The admin was removed.',
      'admin-last':
        'The last admin cannot leave. Add another admin first, or delete the community.',
      'delete-mismatch':
        'The handle you typed does not match. Nothing was deleted.',
    } satisfies Record<AdminNotice, string>,
  },
})

export const adminNoticeText = (notice: AdminNotice, lang: Lang) =>
  text[lang].notices[notice]

/** The id of the line that says why the last admin cannot leave. */
const LAST_ADMIN_NOTE = 'community-admin-last'

/**
 * One admin's row: their name, and "remove", or "stop being an admin" on
 * one's own row. When one is the only admin, "stop being an admin" cannot
 * be pressed and the reason stands beside it (F30-AC52); the service
 * refuses it anyway (F30-AC28).
 */
function adminRow(
  admin: CommunityAdmin,
  input: Readonly<{ community: Community; viewer: string; last: boolean }>,
  lang: Lang,
) {
  const t = text[lang]
  const own = admin.userId === input.viewer
  const stuck = own && input.last
  const path = communityActionPath(
    input.community.id,
    `admins/${encodeURIComponent(admin.userId)}/remove`,
  )
  return html`<li class="community-admin">
    <div class="community-admin-line">
      <a href="${profilePath(admin.handle)}">
        ${admin.name ?? `@${admin.handle}`}
        ${admin.name ? html`<span class="card-meta">@${admin.handle}</span>` : ''}
      </a>
      <form method="post" action="${path}">
        <button
          class="button-secondary"
          type="submit"
          ${own ? '' : html`aria-label="${t.removeLabel(admin.handle)}"`}
          ${stuck ? html`disabled aria-describedby="${LAST_ADMIN_NOTE}"` : ''}
        >
          ${own ? t.leave : t.remove}
        </button>
      </form>
    </div>
    ${
      stuck
        ? html`<p
            class="field-note community-admin-last"
            id="${LAST_ADMIN_NOTE}"
          >
            ${t.lastAdmin}
          </p>`
        : ''
    }
  </li>`
}

/**
 * The admins of a community on its editing page (F30-AC27): each in a row,
 * and a field that adds one by handle.
 */
export function adminsPanel(
  input: Readonly<{
    community: Community
    admins: readonly CommunityAdmin[]
    viewer: string
  }>,
  lang: Lang,
) {
  const t = text[lang]
  const action = (name: string) => communityActionPath(input.community.id, name)
  const last = input.admins.length === 1
  return html`<section
      class="panel community-admins"
      aria-labelledby="community-admins"
    >
      <h2 id="community-admins">${t.admins}</h2>
      <p class="field-note">${t.adminsNote}</p>
      <ul class="people-list">
        ${input.admins.map((admin) =>
          adminRow(
            admin,
            { community: input.community, viewer: input.viewer, last },
            lang,
          ),
        )}
      </ul>
      <form
        class="community-admin-add"
        method="post"
        action="${action('admins')}"
      >
        <label for="community-admin-handle">${t.add}</label>
        <div class="community-link-line">
          ${prefixedField(
            '@',
            html`<input
              id="community-admin-handle"
              name="handle"
              type="text"
              required
              maxlength="39"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
            />`,
          )}
          <button class="button-secondary" type="submit">${t.addButton}</button>
        </div>
      </form>
    </section>
    <p class="field-note community-scope">${t.scope}</p>`
}

/**
 * The deletion at the bottom of the editing page (F30-AC32): what goes and
 * what stays, a field for the handle, and "delete", which the page's script
 * enables only once the handle matches. The service checks it again.
 */
export function deletePanel(community: Community, lang: Lang) {
  const t = text[lang]
  return html`<section
    class="panel community-delete"
    aria-labelledby="community-delete"
  >
    <h2 id="community-delete">${t.delete}</h2>
    <p class="field-note">${t.deleteNote}</p>
    <form method="post" action="${communityActionPath(community.id, 'delete')}">
      <label for="community-delete-confirm"
        >${t.deleteConfirm(community.handle)}</label
      >
      <input
        id="community-delete-confirm"
        name="confirm"
        type="text"
        required
        autocomplete="off"
        autocapitalize="none"
        spellcheck="false"
        data-confirm-match="${community.handle}"
      />
      <button class="button-danger" type="submit" disabled data-confirm-button>
        ${t.deleteButton}
      </button>
    </form>
  </section>`
}
