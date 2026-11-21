import { expect, test } from 'vitest'
import type { DeckSlug } from '../decks/deck-id'
import { operatorHome, type OperatorHomeView } from './pages'

const view = (patch: Partial<OperatorHomeView> = {}): OperatorHomeView => ({
  operator: { email: 'op@example.com' },
  reported: [],
  hidden: [],
  suspended: [],
  total: 0,
  page: 1,
  pages: 1,
  result: null,
  ...patch,
})

test('Given the operator home, When rendered, Then tables and inputs stay and no color block appears', async () => {
  const page = String(
    await operatorHome(
      view({
        result: 'hidden',
        reported: [
          {
            handle: 'owner',
            slug: 'talk' as DeckSlug,
            reporters: 2,
            lastReportedAt: 200,
            reports: [
              {
                reason: 'nuisance',
                note: '確認をお願いします。',
                sharePath: '/@owner/talk',
                updatedAt: 200,
              },
            ],
          },
        ],
        hidden: [
          {
            deckId: 'deck-1',
            slug: 'talk',
            handle: 'owner',
            takedown: {
              hiddenAt: 100,
              reason: 'fake sign-in page',
              operator: 'op@example.com',
            },
          },
        ],
      }),
    ),
  )
  expect(page.match(/class="data-table"/g)).toHaveLength(3)
  expect(page).toContain('id="target"')
  expect(page).toContain('id="reason"')
  expect(page).toContain('id="suspension-target"')
  expect(page).toContain('id="suspension-reason"')
  expect(page).toContain('class="text-input"')
  expect(page).not.toContain('color-block')
  expect(page).toContain('class="notice-success" role="status"')
  expect(page).toContain('非表示にしました。')
  expect(page).toContain('@owner/talk')
  expect(page).toContain('確認をお願いします。')
  expect(page).toContain('action="/takedowns/deck-1/release"')
  expect(page).toContain('class="cell-label"')
})

test('Given an operator error result, When rendered, Then the sentence stays a status', async () => {
  const page = String(await operatorHome(view({ result: 'invalid_reason' })))
  expect(page).toContain('role="status"')
  expect(page).toContain('class="notice-danger"')
  expect(page).not.toContain('role="alert"')
  expect(page).toContain('理由を 1〜')
})
