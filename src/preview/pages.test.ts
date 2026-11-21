import { expect, test } from 'vitest'
import { reopenPage } from './pages'

const words = /作者限定|受領|Open as author|author-only/

test.each(['ja', 'en'] as const)(
  'F02-AC8: Given the page a failed launch shows in %s, When it renders, Then it names no "author-only" or "received" wording and links to the slides',
  async (lang) => {
    const reopen = String(await reopenPage('/slides', lang))
    expect(reopen).not.toMatch(words)
    expect(reopen).toContain('href="/slides"')
  },
)
