import { html } from 'hono/html'
import type { OperatorCommunity } from './admin-store'

const date = (seconds: number) => new Date(seconds * 1000).toISOString()

const field = (id: string, name: string, label: string) =>
  html`<p>
    <label for="${id}">${label}</label>
    <input
      class="text-input"
      id="${id}"
      name="${name}"
      type="text"
      required
      autocomplete="off"
    />
  </p>`

/**
 * The communities on the operator's page (F30-AC36): the list, and the
 * operations the service does on request: add or remove an admin (D-40),
 * change a handle (D-36) and delete. Each names the community by handle.
 */
export const operatorCommunitiesSection = (
  list: readonly OperatorCommunity[],
) =>
  html`<h2>コミュニティ</h2>
    <table class="data-table">
      <tr>
        <th>ハンドル</th>
        <th>名前</th>
        <th>管理者</th>
        <th>作った日時</th>
      </tr>
      ${
        list.length === 0
          ? html`<tr>
              <td colspan="4">コミュニティはありません。</td>
            </tr>`
          : list.map(
              (community) =>
                html`<tr>
                  <td><code>@${community.handle}</code></td>
                  <td>${community.name}</td>
                  <td>
                    ${community.admins.map((admin) => html`<code>@${admin}</code> `)}
                  </td>
                  <td>${date(community.createdAt)}</td>
                </tr>`,
            )
      }
    </table>
    <h3>管理者を足す・外す</h3>
    <p>
      主催者でない人が作っていたときなどに、お問い合わせを受けて管理者を移します。最後の
      1 人は外せないので、先に新しい人を足してから外します。
    </p>
    <form method="post" action="/communities/admins/add">
      ${field('community-admin-community', 'community', 'コミュニティのハンドル')}
      ${field('community-admin-person', 'person', '足す人のハンドル')}
      <button class="button-secondary">管理者を足す</button>
    </form>
    <form method="post" action="/communities/admins/remove">
      ${field('community-unadmin-community', 'community', 'コミュニティのハンドル')}
      ${field('community-unadmin-person', 'person', '外す人のハンドル')}
      <button class="button-secondary">管理者から外す</button>
    </form>
    <h3>ハンドルを変える</h3>
    <p>
      前の URL は、新しい URL へ転送します。前のハンドルは 90
      日の間、だれも取れません。
    </p>
    <form method="post" action="/communities/rename">
      ${field('community-rename-community', 'community', 'コミュニティのハンドル')}
      ${field('community-rename-to', 'to', '新しいハンドル')}
      <button class="button-secondary">ハンドルを変える</button>
    </form>
    <h3>削除する</h3>
    <p>
      コミュニティのページ、ハンドル、紐づけ用リンクがなくなります。スライドとイベントは残ります。
    </p>
    <form method="post" action="/communities/delete">
      ${field('community-delete-community', 'community', 'コミュニティのハンドル')}
      ${field('community-delete-confirm', 'confirm', '確認のため、もう一度ハンドル')}
      <button class="button-secondary">削除する</button>
    </form>`
