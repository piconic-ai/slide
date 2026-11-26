import { describe, expect, test } from 'vitest'
import type { accountInfo } from '../exports/account-info'
import { exportAccountView } from './export-views'

type Info = ReturnType<typeof accountInfo>
const slide = (urlName: string, extra: Partial<Info['slides'][number]> = {}) =>
  ({
    urlName,
    title: null,
    state: 'draft',
    hiddenByOperator: false,
    createdAt: '2026-11-01T00:00:00.000Z',
    firstPublishedAt: null,
    shareUrl: `https://slide.example/@a/${urlName}`,
    cites: ['https://slide.example/@b/theirs/3'],
    ...extra,
  }) as Info['slides'][number]

const info = (slides: Info['slides']) => ({ slides }) as unknown as Info

describe('the answer of export_account', () => {
  test('F35-AC32: Given an account file with slides, When the answer is made, Then it holds the file as it is and a short list with each slide’s name, title and state', () => {
    const file = info([
      slide('a', { title: 'A', state: 'public' }),
      slide('b', { hiddenByOperator: true }),
    ])
    const view = exportAccountView(file)
    expect(view.account).toBe(file)
    expect(view.slides).toEqual([
      { slide: 'a', title: 'A', state: 'public', hiddenByOperator: false },
      { slide: 'b', title: null, state: 'draft', hiddenByOperator: true },
    ])
  })

  test('F35-AC35: Given slides that cite other people’s slides, When the short list is made, Then it carries no address of a slide', () => {
    expect(
      JSON.stringify(exportAccountView(info([slide('a')])).slides),
    ).not.toContain('slide.example')
  })

  test('F35-AC32: Given an author with no slide, When the answer is made, Then the list is empty and the account is still there', () => {
    expect(exportAccountView(info([])).slides).toEqual([])
  })
})
