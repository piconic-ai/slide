import { html } from 'hono/html'
import { adminBadge, adminBadgeStyle } from '../communities/admin-badge'
import type { Handle } from '../share/handle'
import { profilePath } from '../share/path'
import { messages, type Lang } from './i18n'
import { frameHelpLink } from '../help/frame-links'

const text = messages({
  ja: {
    title: '管理しているコミュニティ',
    note: '自分が作ったか、管理者に足されたコミュニティ。',
    none: '管理しているコミュニティはありません。',
    edit: 'コミュニティを編集',
    editLabel: (name: string) => `${name} を編集`,
  },
  en: {
    title: 'Communities you run',
    note: 'The communities you made or were added to as an admin.',
    none: 'You don’t run any community.',
    edit: 'Edit community',
    editLabel: (name: string) => `Edit ${name}`,
  },
})

/** A community the author runs, as the settings list it. */
export type ManagedCommunity = Readonly<{ handle: Handle; name: string }>

/**
 * Where the settings list the communities the author runs, each with the
 * way to edit it (F30-AC35).
 */
export function settingsCommunitiesFrame(
  managed: readonly ManagedCommunity[],
  lang: Lang,
) {
  const t = text[lang]
  return html`${adminBadgeStyle}
    <style>
      .managed-communities li {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 8px 16px;
        padding: 8px 0;
        border-top: 1px solid var(--border);
      }
    </style>
    <section class="panel" id="communities">
      <h2>${t.title}</h2>
      <p class="field-note">${t.note}</p>
      ${frameHelpLink('settings-communities', lang)}
      ${
        managed.length === 0
          ? html`<p class="empty">${t.none}</p>`
          : html`<ul class="people-list managed-communities">
              ${managed.map(
                (community) =>
                  html`<li>
                    <a href="${profilePath(community.handle)}"
                      >${adminBadge(lang)} ${community.name}</a
                    >
                    <a
                      class="button-secondary"
                      href="${profilePath(community.handle)}/edit"
                      aria-label="${t.editLabel(community.name)}"
                      >${t.edit}</a
                    >
                  </li>`,
              )}
            </ul>`
      }
    </section>`
}
