import { describe, expect, it } from 'vitest'
import { nextFields, type ArticleFields } from '../articles/article'
import {
  draftView,
  REVISION_MESSAGES,
  writeBasis,
  writtenView,
  type RevisedArticle,
} from './article-draft'

const urls = {
  editUrl: 'https://slide.example/my/slides/talk/article',
  manageUrl: 'https://slide.example/my/slides/talk',
}
const draft: ArticleFields = { body: 'D', draftBody: null, status: 'draft' }
const published: ArticleFields = {
  body: 'P',
  draftBody: null,
  status: 'published',
}
const pending: ArticleFields = {
  body: 'P',
  draftBody: 'E',
  status: 'published',
}
const at = (fields: ArticleFields, revision = 4): RevisedArticle => ({
  ...fields,
  revision,
})

describe('writeBasis', () => {
  it.each([
    [null, undefined, { ok: true, known: null }],
    [null, 0, { ok: false, reason: 'revision_mismatch' }],
    [null, 1, { ok: false, reason: 'revision_mismatch' }],
    [0, undefined, { ok: false, reason: 'revision_required' }],
    [0, 0, { ok: true, known: 0 }],
    [4, undefined, { ok: false, reason: 'revision_required' }],
    [4, 4, { ok: true, known: 4 }],
    [4, 3, { ok: false, reason: 'revision_mismatch' }],
    [4, 5, { ok: false, reason: 'revision_mismatch' }],
  ] as const)(
    'F23-AC29, F23-AC34, F23-AC35: Given an article at %s, When a write is sent with revision %s, Then it goes ahead on that revision only when they match, and none is needed only without an article',
    (stored, sent, expected) => {
      expect(writeBasis(stored, sent)).toEqual(expected)
    },
  )

  it('F23-AC34, F23-AC35: Given each refusal, When its message is read, Then it says nothing was written and to read again with get_article_draft', () => {
    for (const message of Object.values(REVISION_MESSAGES)) {
      expect(message).toContain('nothing was written')
      expect(message).toContain('get_article_draft')
    }
  })
})

describe('draftView', () => {
  it('F23-AC25: Given no article, When it is read, Then the state is none, with no text or revision, and writing makes a draft', () => {
    expect(draftView('talk', urls, null)).toEqual({
      slide: 'talk',
      state: 'none',
      revision: null,
      body: null,
      ...urls,
      nextStep: expect.stringContaining('without revision'),
    })
  })

  it.each([
    ['a draft', draft, 'D', 'draft'],
    ['a published article', published, 'P', 'published'],
    [
      'a published article with changes',
      pending,
      'E',
      'published_with_changes',
    ],
    [
      'a published article whose working draft is empty',
      { ...published, draftBody: '' },
      '',
      'published_with_changes',
    ],
  ] as const)(
    'F23-AC26, F23-AC27, F23-AC28: Given %s, When it is read, Then the text being edited, its state and its revision come back',
    (_, fields, body, state) => {
      expect(draftView('talk', urls, at(fields))).toMatchObject({
        state,
        body,
        revision: 4,
        ...urls,
      })
    },
  )
})

describe('writtenView', () => {
  it.each([
    [null, 'N', 'draft', 'Publish the article'],
    [draft, 'N', 'draft', 'Publish the article'],
    [published, 'N', 'published_with_changes', 'Update published article'],
    [pending, 'N', 'published_with_changes', 'Update published article'],
    [pending, 'P', 'published', 'no change waits'],
    [published, 'P', 'published', 'no change waits'],
    [published, '', 'published_with_changes', 'Update published article'],
  ] as const)(
    'F23-AC33, F23-AC37: Given %o, When “%s” is written, Then the state is what the editing page’s autosave makes of it, with the next step for the author',
    (current, body, state, step) => {
      const view = writtenView('talk', urls, current, body, 7)
      expect(view).toEqual({
        slide: 'talk',
        state,
        revision: 7,
        ...urls,
        nextStep: expect.stringContaining(step),
      })
      // The state follows the same rule as the store's autosave.
      const after = nextFields(current, 'autosave', body)
      expect(after.status === 'draft').toBe(state === 'draft')
      expect(after.draftBody !== null).toBe(state === 'published_with_changes')
    },
  )
})
