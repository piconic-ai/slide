import { describe, expect, it } from 'vitest'
import { articleMarkdown } from './article-text'

describe('articleMarkdown', () => {
  it('F35-AC11: Given a saved article, When exported, Then it is its text as written, embeds still naming their share URL', () => {
    const body = '# Title\n\n![](https://slide.example/@alice/talk/3)\n'
    expect(articleMarkdown({ body, draftBody: null })).toBe(body)
  })

  it('F35-AC11: Given a published article with an unpublished edit, When exported, Then it is the edit the author last wrote', () => {
    expect(articleMarkdown({ body: 'old', draftBody: 'new' })).toBe('new')
  })

  it('Given an unpublished edit that is empty, When exported, Then it is the empty edit, not the old body', () => {
    expect(articleMarkdown({ body: 'old', draftBody: '' })).toBe('')
  })
})
