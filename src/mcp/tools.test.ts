import { describe, expect, it } from 'vitest'
import type { OwnDeck } from '../decks/own-decks'
import {
  SERVER_INSTRUCTIONS,
  slideLinks,
  slideView,
  statusView,
  toolError,
  toolResult,
} from './tools'

const origin = 'https://slide.example'
const deck: OwnDeck = {
  slug: 'talk',
  isPublic: true,
  shown: { deploymentId: 'd1', title: '<b>Talk</b> 🙂', coverPath: null },
  updatedAt: 1_700_000_000,
}

describe('slideLinks', () => {
  it('Given a public slide of an author with a handle, When its links are made, Then both are absolute URLs of the service', () => {
    expect(slideLinks(origin, 'alice', deck)).toEqual({
      manageUrl: 'https://slide.example/slides/talk',
      shareUrl: 'https://slide.example/@alice/talk',
    })
  })

  it.each([
    ['a private slide', { ...deck, isPublic: false }, 'alice'],
    ['an author without a handle', deck, null],
  ])(
    'Given %s, When its links are made, Then there is no share URL',
    (_, slide, handle) => {
      expect(slideLinks(origin, handle, slide).shareUrl).toBeNull()
    },
  )
})

describe('slideView', () => {
  it('Given a slide whose title holds markup, When it is described, Then the title is data, kept as written', () => {
    expect(slideView(origin, 'alice', deck)).toEqual({
      slide: 'talk',
      title: '<b>Talk</b> 🙂',
      visibility: 'public',
      manageUrl: 'https://slide.example/slides/talk',
      shareUrl: 'https://slide.example/@alice/talk',
      updatedAt: '2023-11-14T22:13:20.000Z',
    })
  })

  it('Given a slide with no version yet, When it is described, Then its URL name stands in for the title', () => {
    expect(
      slideView(origin, null, { ...deck, isPublic: false, shown: null }),
    ).toMatchObject({ title: 'talk', visibility: 'private', shareUrl: null })
  })
})

describe('statusView', () => {
  const newest = {
    id: 'd2',
    state: 'ready',
    createdAt: 10,
    readyAt: 20,
  } as const

  it('Given a ready upload that is not the public version, When the status is made, Then it says so', () => {
    expect(statusView(origin, 'alice', deck, newest).newestUpload).toEqual({
      uploadId: 'd2',
      state: 'ready',
      startedAt: '1970-01-01T00:00:10.000Z',
      readyAt: '1970-01-01T00:00:20.000Z',
      isPublicVersion: false,
    })
  })

  it('Given the public version is the newest upload, When the status is made, Then it says so', () => {
    expect(
      statusView(origin, 'alice', deck, { ...newest, id: 'd1' }).newestUpload,
    ).toMatchObject({ isPublicVersion: true })
  })

  it('Given a failed upload and nothing public, When the status is made, Then it has no ready time and is not the public version', () => {
    expect(
      statusView(origin, 'alice', deck, {
        id: 'd3',
        state: 'failed',
        createdAt: 10,
        readyAt: null,
      }).newestUpload,
    ).toMatchObject({ state: 'failed', readyAt: null, isPublicVersion: false })
  })

  it('Given a slide readers cannot see, whose list shows its newest ready version, When the status is made, Then that version is not called public', () => {
    expect(
      statusView(
        origin,
        'alice',
        { ...deck, isPublic: false },
        { ...newest, id: 'd1' },
      ).newestUpload,
    ).toMatchObject({ isPublicVersion: false })
  })

  it('Given no upload at all, When the status is made, Then the newest upload is null', () => {
    expect(statusView(origin, 'alice', deck, null).newestUpload).toBeNull()
  })
})

describe('tool results', () => {
  it('Given a value, When it is returned, Then the text is its JSON and the structured content the same value', () => {
    const result = toolResult({ a: 1 })
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual({ a: 1 })
    expect(result.structuredContent).toEqual({ a: 1 })
    expect(result.isError).toBeUndefined()
  })

  it('Given a refusal, When it is returned, Then it is an error result carrying a code and a message for the author', () => {
    const result = toolError('unknown_slide')
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({ error: 'unknown_slide' })
    expect(result.content[0]?.text).toContain('list_slides')
  })

  it('Given the instructions, When an agent reads them, Then they say what cannot be done, the limits, and to send files and not a zip', () => {
    expect(SERVER_INSTRUCTIONS).toContain('cannot publish, unpublish or delete')
    expect(SERVER_INSTRUCTIONS).toContain('10 MB per version')
    expect(SERVER_INSTRUCTIONS).toContain('5 MB per file')
    expect(SERVER_INSTRUCTIONS).toContain('100 files')
    expect(SERVER_INSTRUCTIONS).toContain('not as a zip')
  })
})
