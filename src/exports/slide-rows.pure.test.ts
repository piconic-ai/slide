import { describe, expect, it } from 'vitest'
import { slideRowSchema, summarizeSlide, type SlideRow } from './slide-rows'

const row = (patch: Partial<SlideRow> = {}): SlideRow => ({
  slug: 'talk',
  created_at: 10,
  first_published_at: null,
  paused_at: null,
  hidden_at: null,
  public_deployment_id: null,
  resume_deployment_id: null,
  pointed_id: null,
  pointed_ready_at: null,
  pointed_order: null,
  pointed_title: null,
  latest_id: null,
  latest_ready_at: null,
  latest_order: null,
  latest_title: null,
  has_article: 0,
  ...patch,
})

describe('summarizeSlide', () => {
  it('F35-AC15: Given a slide with nothing received, When summarized, Then it has no zip to offer', () => {
    const summary = summarizeSlide(row())
    expect(summary.versions).toEqual({ published: null, prepared: null })
    expect(summary.title).toBeNull()
    expect(summary.publication).toBe('draft')
  })

  it('F35-AC15: Given a hidden slide, When summarized, Then it is marked hidden and is still a summary', () => {
    expect(summarizeSlide(row({ hidden_at: 5 })).hiddenByOperator).toBe(true)
  })

  it('F35-AC4: Given a published slide with a newer version, When summarized, Then both are offered and the title is the published one', () => {
    const summary = summarizeSlide(
      row({
        public_deployment_id: 'p',
        pointed_id: 'p',
        pointed_ready_at: 100,
        pointed_order: 1,
        pointed_title: 'Published title',
        latest_id: 'n',
        latest_ready_at: 200,
        latest_order: 2,
        latest_title: 'Newer title',
      }),
    )
    expect(summary.publication).toBe('public')
    expect(summary.versions.published?.deploymentId).toBe('p')
    expect(summary.versions.prepared?.deploymentId).toBe('n')
    expect(summary.title).toBe('Published title')
  })

  it('F35-AC6: Given a stopped slide, When summarized, Then the version to bring back is the published one', () => {
    const summary = summarizeSlide(
      row({
        paused_at: 50,
        resume_deployment_id: 'p',
        pointed_id: 'p',
        pointed_ready_at: 100,
        pointed_order: 1,
        latest_id: 'p',
        latest_ready_at: 100,
        latest_order: 1,
      }),
    )
    expect(summary.publication).toBe('paused')
    expect(summary.versions.published?.deploymentId).toBe('p')
    expect(summary.versions.prepared).toBeNull()
  })

  it('Given a pointer whose version row is gone, When summarized, Then there is no published version rather than a failure', () => {
    const summary = summarizeSlide(
      row({
        public_deployment_id: 'gone',
        latest_id: 'n',
        latest_ready_at: 9,
        latest_order: 3,
      }),
    )
    expect(summary.versions.published).toBeNull()
  })

  it('Given a row with a text where a number belongs, When parsed, Then it is refused', () => {
    expect(() => slideRowSchema.parse({ ...row(), created_at: 'x' })).toThrow()
  })

  it('F35-AC11: Given an article, When summarized, Then the article is known to exist', () => {
    expect(summarizeSlide(row({ has_article: 1 })).hasArticle).toBe(true)
  })
})
