import { expect, test } from 'vitest'
import { adminBadge } from './admin-badge'

test.each([
  ['ja', '管理者'],
  ['en', 'Admin'],
] as const)(
  'F30-AC34: Given the admin mark in %s, When it is drawn, Then the key is hidden from screen readers and "%s" is read in its place',
  (lang, word) => {
    const badge = String(adminBadge(lang))
    expect(badge).toMatch(
      /<svg[^>]*aria-hidden="true"[^>]*width="16"[^>]*height="16"/,
    )
    expect(badge).toContain(`<span class="visually-hidden">${word}</span>`)
  },
)
