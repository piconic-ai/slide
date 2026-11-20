import { expect, test } from 'vitest'
import { launchPage, reopenPage } from './pages'

const words = /作者限定|受領|Open as author|author-only/

test.each(['ja', 'en'] as const)(
  'F02-AC8: Given the page opened right after "見る" in %s, When it renders, Then it names no "author-only" or "received" wording',
  async (lang) => {
    const launch = String(
      await launchPage('https://d.example/launch', 'token', 'nonce', lang),
    )
    const reopen = String(await reopenPage('/slides', lang))
    expect(launch).not.toMatch(words)
    expect(reopen).not.toMatch(words)
  },
)
