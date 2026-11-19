import { expect, test } from 'vitest'
import { japaneseOutside } from '../site/test-japanese'
import { refusalPage, refusalPath, signInRefusals } from './pages'

const urlOf = (reason: (typeof signInRefusals)[number]) =>
  new URL(`https://slide.example${refusalPath(reason)}`)

test('F22-AC22: Given the invitation-only page in Japanese, When rendered, Then it says sign-in is by invitation and links to the top and the contact page', async () => {
  const page = String(await refusalPage('uninvited', 'ja', urlOf('uninvited')))

  expect(page).toContain('<html lang="ja">')
  expect(page).toContain('招待制です')
  expect(page).toContain('登録されていません')
  expect(page).toContain('href="/"')
  expect(page).toContain('href="/contact"')
  expect(page).toContain('href="/auth/invitation-only?lang=en"')
  expect(page).toContain('name="robots" content="noindex"')
})

test('F22-AC26: Given the handle-taken page in Japanese, When rendered, Then it gives the reason and points to the contact page', async () => {
  const page = String(
    await refusalPage('handle_taken', 'ja', urlOf('handle_taken')),
  )

  expect(page).toContain('ログインできませんでした')
  expect(page).toContain('ほかの人が共有 URL')
  expect(page).toContain('href="/contact"')
  expect(page).toContain('href="/auth/handle-taken?lang=en"')
})

test.each(signInRefusals)(
  'Given the %s page in English, When rendered, Then it is English throughout',
  async (reason) => {
    const page = String(await refusalPage(reason, 'en', urlOf(reason)))

    expect(page).toContain('<html lang="en">')
    expect(japaneseOutside(page)).toEqual([])
  },
)
