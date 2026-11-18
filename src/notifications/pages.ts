import { html } from 'hono/html'
import { dayFormats } from '../share/dates'
import { deckName } from '../share/list-pages'
import { profilePath, sharePath } from '../share/path'
import { messages, type Lang } from '../site/i18n'
import type { Notification } from './notification'

const text = messages({
  ja: {
    title: 'お知らせ',
    withUnread: (count: number) => `お知らせ(${count})`,
    cited: (actor: string, deck: string, target: string) =>
      `@${actor} さんのスライド「${deck}」が、あなたのスライド「${target}」を引用しました`,
    joined: (actor: string) =>
      `GitHub でフォローしている @${actor} さんが、slide を使い始めました`,
    published: (actor: string, deck: string) =>
      `@${actor} さんが、スライド「${deck}」を公開しました`,
    followed: (actor: string) => `@${actor} さんに、フォローされました`,
    new: '新着',
    empty: 'お知らせはありません。',
    slides: 'スライドの管理に戻る',
    preferences: '受け取るお知らせを選ぶ',
  },
  en: {
    title: 'Notifications',
    withUnread: (count: number) => `Notifications (${count})`,
    cited: (actor: string, deck: string, target: string) =>
      `@${actor}'s slides “${deck}” cite your slides “${target}”`,
    joined: (actor: string) =>
      `@${actor}, whom you follow on GitHub, started using slide`,
    published: (actor: string, deck: string) => `@${actor} published “${deck}”`,
    followed: (actor: string) => `@${actor} followed you`,
    new: 'New',
    empty: 'No notifications.',
    slides: 'Back to your slides',
    preferences: 'Choose what you receive',
  },
})

export const notificationsTitle = (lang: Lang, unread = 0) =>
  unread > 0 ? text[lang].withUnread(unread) : text[lang].title

function notificationLink(item: Notification, lang: Lang) {
  const t = text[lang]
  switch (item.kind) {
    case 'cited': {
      const label = t.cited(
        item.actor.handle,
        deckName(item.deck),
        deckName(item.target),
      )
      return html`<a href="${sharePath(item.deck.handle, item.deck.slug)}"
        >${label}</a
      >`
    }
    case 'followee_published':
      return html`<a href="${sharePath(item.deck.handle, item.deck.slug)}"
        >${t.published(item.actor.handle, deckName(item.deck))}</a
      >`
    case 'followed':
      return html`<a href="${profilePath(item.actor.handle)}"
        >${t.followed(item.actor.handle)}</a
      >`
    case 'github_followee_joined':
      return html`<a href="${profilePath(item.actor.handle)}"
        >${t.joined(item.actor.handle)}</a
      >`
  }
}

function notificationItem(item: Notification, lang: Lang) {
  const date = new Date(item.at * 1000)
  return html`<li${item.unread ? html` class="unread"` : ''}>
    <time datetime="${date.toISOString()}">${dayFormats[lang].format(date)}</time>
    ${item.unread ? html`<strong>${text[lang].new}</strong>` : ''}
    ${notificationLink(item, lang)}
  </li>`
}

export function notificationsBody(items: readonly Notification[], lang: Lang) {
  const t = text[lang]
  return html`<h1>${t.title}</h1>
    ${
      items.length
        ? html`<ul>
            ${items.map((item) => notificationItem(item, lang))}
          </ul>`
        : html`<p>${t.empty}</p>`
    }
    <p><a href="/settings#notifications">${t.preferences}</a></p>
    <p><a href="/slides">${t.slides}</a></p>`
}
