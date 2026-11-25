import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'

const text = messages({ ja: { admin: '管理者' }, en: { admin: 'Admin' } })

/**
 * The mark beside a community's name for the people who run it: a grey key
 * of 16px, read out as "admin" (F30-AC34). The profile's communities tab
 * and the settings show it.
 */
export const adminBadge = (lang: Lang) =>
  html`<span class="admin-badge"
    ><svg
      aria-hidden="true"
      focusable="false"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
    >
      <circle cx="5" cy="11" r="3" />
      <path d="M7.2 8.8 13 3M11 5l1.5 1.5M9.5 6.5 11 8" /></svg
    ><span class="visually-hidden">${text[lang].admin}</span></span
  >`

/** How the mark stands beside a name; pages that show it carry this. */
export const adminBadgeStyle = html`<style>
  .admin-badge {
    display: inline-flex;
    align-items: center;
    vertical-align: -2px;
    color: var(--muted-foreground);
  }
</style>`
