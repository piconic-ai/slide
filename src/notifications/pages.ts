import { html } from 'hono/html'
import { dayFormats } from '../share/dates'
import { deckName } from '../share/list-pages'
import { profilePath, sharePath } from '../share/path'
import { messages, type Lang } from '../site/i18n'
import { SERVICE_NAME } from '../site/service'
import type { Notification } from './notification'

const text = messages({
  ja: {
    title: 'お知らせ',
    withUnread: (count: number) => `お知らせ(${count})`,
    cited: (actor: string, deck: string, target: string) =>
      `@${actor} さんのスライド「${deck}」が、あなたのスライド「${target}」を引用しました`,
    published: (actor: string, deck: string) =>
      `@${actor} さんが、スライド「${deck}」を公開しました`,
    followed: (actor: string) => `@${actor} さんに、フォローされました`,
    new: '新着',
    empty: 'お知らせはありません。',
    preferences: '受け取るお知らせを選ぶ',
  },
  en: {
    title: 'Notifications',
    withUnread: (count: number) => `Notifications (${count})`,
    cited: (actor: string, deck: string, target: string) =>
      `@${actor}'s slides “${deck}” cite your slides “${target}”`,
    published: (actor: string, deck: string) => `@${actor} published “${deck}”`,
    followed: (actor: string) => `@${actor} followed you`,
    new: 'New',
    empty: 'No notifications.',
    preferences: 'Choose what you receive',
  },
})

export const notificationsTitle = (lang: Lang, unread = 0) =>
  unread > 0 ? text[lang].withUnread(unread) : text[lang].title

function notificationLink(
  item: Notification,
  lang: Lang,
): { href: string; label: string } {
  const t = text[lang]
  switch (item.kind) {
    case 'cited':
      return {
        href: sharePath(item.deck.handle, item.deck.slug),
        label: t.cited(
          item.actor.handle,
          deckName(item.deck),
          deckName(item.target),
        ),
      }
    case 'followee_published':
      return {
        href: sharePath(item.deck.handle, item.deck.slug),
        label: t.published(item.actor.handle, deckName(item.deck)),
      }
    case 'followed':
      return {
        href: profilePath(item.actor.handle),
        label: t.followed(item.actor.handle),
      }
  }
}

function notificationItem(item: Notification, lang: Lang) {
  const date = new Date(item.at * 1000)
  const { href, label } = notificationLink(item, lang)
  return html`<li${item.unread ? html` class="unread"` : ''}>
    <a class="notification-item" href="${href}">
      ${
        item.unread
          ? html`<span class="unread-dot" aria-hidden="true"></span>`
          : ''
      }
      <span class="notification-message">${label}</span>
      <span class="notification-meta">
        <time datetime="${date.toISOString()}">${dayFormats[lang].format(date)}</time>
        ${item.unread ? html`<span class="new-badge">${text[lang].new}</span>` : ''}
      </span>
    </a>
  </li>`
}

export function notificationsBody(items: readonly Notification[], lang: Lang) {
  const t = text[lang]
  return html`<div class="narrow">
    <h1>${t.title}</h1>
    ${
      items.length
        ? html`<ul class="notification-list" role="list">
              ${items.map((item) => notificationItem(item, lang))}
            </ul>
            <p><a href="/settings#notifications">${t.preferences}</a></p>`
        : html`<div class="empty-state">
            <p>${t.empty}</p>
            <p>
              <a class="cta" href="/settings#notifications">${t.preferences}</a>
            </p>
          </div>`
    }
  </div>`
}
