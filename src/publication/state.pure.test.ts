import { describe, expect, test } from 'vitest'
import {
  parseDeckPublication,
  publicationColumns,
  type DeckPublicationRow,
} from './state'

const row = (overrides: Partial<DeckPublicationRow> = {}) => ({
  paused_at: null,
  public_deployment_id: null,
  resume_deployment_id: null,
  revision: 0,
  ...overrides,
})

describe('parseDeckPublication', () => {
  test('F02-AC62: Given a new deck, When parsed, Then it is a draft with no publishing mode', () => {
    expect(parseDeckPublication(row())).toEqual({
      publication: { kind: 'draft' },
      revision: 0,
    })
  })

  test('Given a public pointer, When parsed, Then the deck is public', () => {
    expect(
      parseDeckPublication(row({ public_deployment_id: 'a' })).publication,
    ).toEqual({ kind: 'public', deploymentId: 'a' })
  })

  test('Given a paused deck, When parsed, Then it keeps what resume restores', () => {
    expect(
      parseDeckPublication(row({ paused_at: 5, resume_deployment_id: 'a' }))
        .publication,
    ).toEqual({ kind: 'paused', resumeTo: 'a' })
    expect(parseDeckPublication(row({ paused_at: 5 })).publication).toEqual({
      kind: 'paused',
      resumeTo: null,
    })
  })

  test.each([
    ['public while paused', { paused_at: 5, public_deployment_id: 'a' }],
    ['resume target without a pause', { resume_deployment_id: 'a' }],
    ['negative revision', { revision: -1 }],
    ['a revision that is not a whole number', { revision: 1.5 }],
    ['a missing revision', { revision: undefined }],
  ])('Given %s, When parsed, Then it is rejected', (_, overrides) => {
    expect(() =>
      parseDeckPublication(row(overrides as Partial<DeckPublicationRow>)),
    ).toThrow()
  })
})

describe('publicationColumns', () => {
  test('Given each state, When stored, Then only public sets the public pointer', () => {
    expect(publicationColumns({ kind: 'draft' }, 7)).toEqual({
      paused_at: null,
      public_deployment_id: null,
      resume_deployment_id: null,
    })
    expect(
      publicationColumns({ kind: 'public', deploymentId: 'a' }, 7),
    ).toEqual({
      paused_at: null,
      public_deployment_id: 'a',
      resume_deployment_id: null,
    })
    expect(publicationColumns({ kind: 'paused', resumeTo: 'a' }, 7)).toEqual({
      paused_at: 7,
      public_deployment_id: null,
      resume_deployment_id: 'a',
    })
  })

  test('Given stored columns, When parsed back, Then the state round-trips', () => {
    for (const publication of [
      { kind: 'draft' },
      { kind: 'public', deploymentId: 'a' },
      { kind: 'paused', resumeTo: null },
      { kind: 'paused', resumeTo: 'a' },
    ] as const)
      expect(
        parseDeckPublication(row(publicationColumns(publication, 7)))
          .publication,
      ).toEqual(publication)
  })
})
