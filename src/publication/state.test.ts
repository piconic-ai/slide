import { describe, expect, test } from 'vitest'
import {
  compareCiRuns,
  parseDeckPublication,
  publicationColumns,
  type DeckPublicationRow,
} from './state'

const row = (overrides: Partial<DeckPublicationRow> = {}) => ({
  publication_mode: 'manual',
  paused_at: null,
  public_deployment_id: null,
  resume_deployment_id: null,
  revision: 0,
  author_revision: 0,
  ci_run_id: null,
  ci_run_attempt: null,
  ...overrides,
})

describe('parseDeckPublication', () => {
  test('Given a new deck, When parsed, Then it is a manual draft', () => {
    expect(parseDeckPublication(row())).toEqual({
      mode: 'manual',
      publication: { kind: 'draft' },
      revision: 0,
      authorRevision: 0,
      lastCiRun: null,
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

  test('Given a recorded CI run, When parsed, Then it is kept for ordering', () => {
    expect(
      parseDeckPublication(row({ ci_run_id: 9, ci_run_attempt: 2 })).lastCiRun,
    ).toEqual({ runId: 9, attempt: 2 })
  })

  test.each([
    ['public while paused', { paused_at: 5, public_deployment_id: 'a' }],
    ['resume target without a pause', { resume_deployment_id: 'a' }],
    ['author revision ahead', { revision: 1, author_revision: 2 }],
    ['CI run without attempt', { ci_run_id: 9 }],
    ['CI attempt without run', { ci_run_attempt: 1 }],
    ['negative revision', { revision: -1 }],
    ['unknown mode', { publication_mode: 'auto' }],
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

describe('compareCiRuns', () => {
  test('Given runs, When compared, Then run ID orders before attempt', () => {
    expect(
      compareCiRuns({ runId: 1, attempt: 9 }, { runId: 2, attempt: 1 }),
    ).toBeLessThan(0)
    expect(
      compareCiRuns({ runId: 2, attempt: 1 }, { runId: 2, attempt: 2 }),
    ).toBeLessThan(0)
    expect(
      compareCiRuns({ runId: 2, attempt: 2 }, { runId: 2, attempt: 2 }),
    ).toBe(0)
  })
})
