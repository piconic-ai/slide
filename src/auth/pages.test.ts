import { expect, test } from 'vitest'
import { japaneseOutside } from '../site/test-japanese'
import { invitationOnlyPage, INVITATION_ONLY_PATH } from './pages'

const url = new URL(`https://slide.example${INVITATION_ONLY_PATH}`)

test('F01-AC6: Given the invitation-only page in Japanese, When rendered, Then it says sign-in is by invitation and links to the top and the contact page', async () => {
  const page = String(await invitationOnlyPage('ja', url))

  expect(page).toContain('<html lang="ja">')
  expect(page).toContain('招待制です')
  expect(page).toContain('登録されていません')
  expect(page).toContain('href="/"')
  expect(page).toContain('href="/contact"')
  expect(page).toContain('href="/auth/invitation-only?lang=en"')
  expect(page).toContain('name="robots" content="noindex"')
})

test('F01-AC6: Given the invitation-only page in English, When rendered, Then it is English throughout', async () => {
  const page = String(await invitationOnlyPage('en', url))

  expect(page).toContain('<html lang="en">')
  expect(page).toContain('Invitation only')
  expect(japaneseOutside(page)).toEqual([])
})
