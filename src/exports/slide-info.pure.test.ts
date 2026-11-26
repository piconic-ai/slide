import { describe, expect, it } from 'vitest'
import {
  jsonText,
  SLIDE_INFO_SCHEMA_VERSION,
  slideInfo,
  type SlideInfoInput,
} from './slide-info'

const sha = 'a'.repeat(64)
const input = (patch: Partial<SlideInfoInput> = {}): SlideInfoInput => ({
  exportedAt: 1_800_000_000,
  slide: {
    urlName: 'talk',
    title: 'A talk',
    publication: 'public',
    hiddenByOperator: false,
    createdAt: 1_700_000_000,
    firstPublishedAt: 1_700_000_100,
    shareUrl: 'https://slide.example/@alice/talk',
  },
  links: [{ kind: 'video', url: 'https://example.com/v', title: null }],
  events: [{ service: 'connpass', name: 'Meetup', ref: '123' }],
  article: {
    status: 'published',
    updatedAt: 1_700_000_200,
    hasUnpublishedEdit: true,
  },
  versions: [
    {
      role: 'published',
      deploymentId: 'dep-1',
      title: 'A talk',
      description: null,
      receivedAt: 1_700_000_050,
      totalBytes: 12,
      files: [
        { path: 'index.html', size: 12, sha256: sha, mediaType: 'text/html' },
      ],
    },
  ],
  ...patch,
})

describe('slideInfo', () => {
  it('F35-AC13: Given a slide, When its information is made, Then it carries the shape version', () => {
    expect(slideInfo(input()).schemaVersion).toBe(SLIDE_INFO_SCHEMA_VERSION)
    expect(SLIDE_INFO_SCHEMA_VERSION).toBe(1)
  })

  it('F35-AC12: Given a slide, When its information is made, Then it has the title, URL name, state, publication time, links, events and the files with their SHA-256', () => {
    const info = slideInfo(input())
    expect(info.slide).toMatchObject({
      urlName: 'talk',
      title: 'A talk',
      state: 'public',
      firstPublishedAt: '2023-11-14T22:15:00.000Z',
    })
    expect(info.relatedLinks).toEqual([
      { kind: 'video', url: 'https://example.com/v', title: null },
    ])
    expect(info.events).toEqual([
      { service: 'connpass', name: 'Meetup', ref: '123' },
    ])
    expect(info.versions[0]?.files).toEqual([
      { path: 'index.html', size: 12, sha256: sha, mediaType: 'text/html' },
    ])
  })

  it('Given a slide never published and with no article, When made, Then those are null, not missing', () => {
    const info = slideInfo(
      input({
        slide: {
          ...input().slide,
          publication: 'draft',
          firstPublishedAt: null,
          shareUrl: null,
        },
        article: null,
        versions: [],
      }),
    )
    expect(info.slide.firstPublishedAt).toBeNull()
    expect(info.article).toBeNull()
    expect(info.versions).toEqual([])
    expect(JSON.parse(jsonText(info))).toHaveProperty('article', null)
  })

  it('Given extra facts on the files, When made, Then only the four named fields come out (no storage key)', () => {
    const files = [
      {
        path: 'a',
        size: 1,
        sha256: sha,
        mediaType: 'x/y',
        objectKey: 'dep/0/lease',
      },
    ] as never
    const info = slideInfo(
      input({ versions: [{ ...input().versions[0]!, files }] }),
    )
    expect(JSON.stringify(info)).not.toContain('objectKey')
    expect(JSON.stringify(info)).not.toContain('lease')
  })

  it('Given text with quotes, newlines and emoji, When printed, Then it parses back unchanged', () => {
    const title = 'He said "hi"\n\u{1F600} </script>'
    const info = slideInfo(input({ slide: { ...input().slide, title } }))
    const text = jsonText(info)
    expect(JSON.parse(text).slide.title).toBe(title)
    expect(text.endsWith('\n')).toBe(true)
  })
})
