import { html } from 'hono/html'
import { messages } from '../site/i18n'
import type { LinkKind } from './link'

/** The name of each kind of link, shown beside its icon. */
export const kindNames = messages({
  ja: { video: '動画', article: '記事', other: 'その他' },
  en: { video: 'Video', article: 'Article', other: 'Other' },
})

const paths: Record<LinkKind, ReturnType<typeof html>> = {
  video: html`<rect x="2.5" y="4" width="15" height="12" rx="3" /><path
      d="M8.5 7.5v5l4-2.5z"
    />`,
  article: html`<path d="M5 2.5h6.5L15 6v11.5H5z" /><path
      d="M11 2.5V6.5h4"
    /><path d="M7.5 10h5M7.5 13h5" />`,
  other: html`<path
    d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.8.8M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.8-.8"
  />`,
}

/** The icon of a kind. It decorates the name next to it, so it is hidden from readers. */
export const linkIcon = (kind: LinkKind) =>
  html`<svg
    class="link-icon"
    viewBox="0 0 20 20"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    ${paths[kind]}
  </svg>`
