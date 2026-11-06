import { describe, expect, test } from 'vitest'
import type { DeckPublication, Publication } from './state'
import { decideAuthor, decideCi, type CiPublication } from './transitions'

const deck = (
  publication: Publication,
  overrides: Partial<DeckPublication> = {},
): DeckPublication => ({
  mode: 'manual',
  publication,
  revision: 4,
  authorRevision: 2,
  lastCiRun: null,
  ...overrides,
})
const draft = { kind: 'draft' } as const
const publicA = { kind: 'public', deploymentId: 'a' } as const

describe('decideAuthor', () => {
  test('Given a draft, When B is published, Then B is public and its owner sessions end', () => {
    expect(
      decideAuthor(deck(draft), { kind: 'publish', deploymentId: 'b' }, 4),
    ).toEqual({
      kind: 'apply',
      transition: {
        next: deck(
          { kind: 'public', deploymentId: 'b' },
          { revision: 5, authorRevision: 5 },
        ),
        revoke: { kind: 'deployment', deploymentId: 'b' },
      },
    })
  })

  test('Given B is public, When the author picks A, Then it rolls back explicitly', () => {
    const decision = decideAuthor(
      deck({ kind: 'public', deploymentId: 'b' }),
      { kind: 'publish', deploymentId: 'a' },
      4,
    )
    expect(
      decision.kind === 'apply' && decision.transition.next.publication,
    ).toEqual(publicA)
  })

  test.each([
    ['publish', { kind: 'publish', deploymentId: 'b' }],
    ['resume', { kind: 'resume' }],
    ['set_mode', { kind: 'set_mode', mode: 'repository' }],
  ] as const)(
    'Given a newer revision, When an older view sends %s, Then it conflicts and keeps the current state',
    (_, command) => {
      const current = deck({ kind: 'paused', resumeTo: 'a' })
      expect(decideAuthor(current, command, 3)).toEqual({
        kind: 'conflict',
        current,
      })
    },
  )

  test('Given CI published B after the author looked at A, When the author pauses from the older view, Then B is stopped too', () => {
    const decision = decideAuthor(
      deck({ kind: 'public', deploymentId: 'b' }, { revision: 5 }),
      { kind: 'pause' },
      4,
    )
    expect(decision).toEqual({
      kind: 'apply',
      transition: {
        next: deck(
          { kind: 'paused', resumeTo: 'b' },
          { revision: 6, authorRevision: 6 },
        ),
        revoke: { kind: 'deck' },
      },
    })
  })

  test('Given A is public, When paused, Then nothing is public, A is remembered and all owner sessions end', () => {
    expect(decideAuthor(deck(publicA), { kind: 'pause' }, 4)).toEqual({
      kind: 'apply',
      transition: {
        next: deck(
          { kind: 'paused', resumeTo: 'a' },
          { revision: 5, authorRevision: 5 },
        ),
        revoke: { kind: 'deck' },
      },
    })
  })

  test('Given a draft, When paused, Then it pauses with nothing to resume', () => {
    const decision = decideAuthor(deck(draft), { kind: 'pause' }, 4)
    expect(
      decision.kind === 'apply' && decision.transition.next.publication,
    ).toEqual({ kind: 'paused', resumeTo: null })
  })

  test('Given a paused deck, When resumed, Then the remembered deployment returns', () => {
    const decision = decideAuthor(
      deck({ kind: 'paused', resumeTo: 'a' }),
      { kind: 'resume' },
      4,
    )
    expect(decision.kind === 'apply' && decision.transition).toEqual({
      next: deck(publicA, { revision: 5, authorRevision: 5 }),
      revoke: { kind: 'deployment', deploymentId: 'a' },
    })
    const empty = decideAuthor(
      deck({ kind: 'paused', resumeTo: null }),
      { kind: 'resume' },
      4,
    )
    expect(empty.kind === 'apply' && empty.transition.next.publication).toEqual(
      draft,
    )
  })

  test('Given a deck that is not paused, When resumed, Then it is refused', () => {
    expect(decideAuthor(deck(publicA), { kind: 'resume' }, 4)).toEqual({
      kind: 'not_paused',
    })
  })

  test('Given a paused deck, When B is published by hand, Then the explicit publish ends the pause', () => {
    const decision = decideAuthor(
      deck({ kind: 'paused', resumeTo: 'a' }),
      { kind: 'publish', deploymentId: 'b' },
      4,
    )
    expect(
      decision.kind === 'apply' && decision.transition.next.publication,
    ).toEqual({ kind: 'public', deploymentId: 'b' })
  })

  test('Given a paused deck, When the mode changes, Then it stays paused', () => {
    const paused = { kind: 'paused', resumeTo: 'a' } as const
    const decision = decideAuthor(
      deck(paused),
      { kind: 'set_mode', mode: 'repository' },
      4,
    )
    expect(decision.kind === 'apply' && decision.transition.next).toEqual(
      deck(paused, { mode: 'repository', revision: 5, authorRevision: 5 }),
    )
  })

  test.each([
    [
      'publishing the public deployment',
      deck(publicA),
      { kind: 'publish', deploymentId: 'a' },
    ],
    [
      'pausing a paused deck',
      deck({ kind: 'paused', resumeTo: 'a' }),
      { kind: 'pause' },
    ],
    [
      'choosing the current mode',
      deck(draft),
      { kind: 'set_mode', mode: 'manual' },
    ],
  ] as const)(
    'Given %s, When requested, Then nothing changes',
    (_, current, command) => {
      expect(decideAuthor(current, command, 4)).toEqual({ kind: 'unchanged' })
    },
  )
})

describe('decideCi', () => {
  const repository = (publication: Publication, overrides = {}) =>
    deck(publication, { mode: 'repository', ...overrides })
  const ci = (overrides: Partial<CiPublication> = {}): CiPublication => ({
    deploymentId: 'b',
    startRevision: 4,
    intent: 'published',
    run: { runId: 20, attempt: 1 },
    ...overrides,
  })

  test('Given repository mode, When a run asks to publish, Then it becomes public without an author revision', () => {
    expect(decideCi(repository(publicA), ci())).toEqual({
      kind: 'apply',
      transition: {
        next: repository(
          { kind: 'public', deploymentId: 'b' },
          { revision: 5, lastCiRun: { runId: 20, attempt: 1 } },
        ),
        revoke: { kind: 'deployment', deploymentId: 'b' },
      },
    })
  })

  test('Given A is public, When a run says published: false, Then public delivery stops', () => {
    const decision = decideCi(
      repository(publicA),
      ci({ intent: 'unpublished' }),
    )
    expect(decision.kind === 'apply' && decision.transition).toEqual({
      next: repository(draft, {
        revision: 5,
        lastCiRun: { runId: 20, attempt: 1 },
      }),
      revoke: { kind: 'none' },
    })
  })

  test('Given a newer run already applied, When an older run finishes, Then it stays a draft', () => {
    expect(
      decideCi(
        repository(publicA, { lastCiRun: { runId: 30, attempt: 1 } }),
        ci(),
      ),
    ).toEqual({ kind: 'skip', reason: 'older_run' })
  })

  test('Given a newer attempt already applied, When an older attempt of the run finishes, Then it is skipped', () => {
    expect(
      decideCi(
        repository(publicA, { lastCiRun: { runId: 20, attempt: 2 } }),
        ci(),
      ),
    ).toEqual({ kind: 'skip', reason: 'older_run' })
  })

  test('Given an older run applied first, When the newer run finishes, Then the newer one wins', () => {
    const decision = decideCi(
      repository(publicA, {
        revision: 5,
        lastCiRun: { runId: 10, attempt: 1 },
      }),
      ci({ startRevision: 3 }),
    )
    expect(decision.kind).toBe('apply')
  })

  test('Given the same result was applied, When the run is resent, Then nothing changes', () => {
    expect(
      decideCi(
        repository(
          { kind: 'public', deploymentId: 'b' },
          {
            lastCiRun: { runId: 20, attempt: 1 },
          },
        ),
        ci(),
      ),
    ).toEqual({ kind: 'skip', reason: 'recorded_run' })
  })

  test('Given one attempt uploaded A then B, When A is resent, Then the first applied deployment stays public', () => {
    const first = decideCi(repository(draft), ci({ deploymentId: 'a' }))
    const next = first.kind === 'apply' ? first.transition.next : null
    expect(next?.publication).toEqual(publicA)
    for (const deploymentId of ['b', 'a'])
      expect(next && decideCi(next, ci({ deploymentId }))).toEqual({
        kind: 'skip',
        reason: 'recorded_run',
      })
  })

  test('Given a newer run kept the current result, When an older run finishes later, Then it cannot publish', () => {
    const recorded = decideCi(
      repository(draft),
      ci({
        deploymentId: 'c',
        intent: 'unpublished',
        run: { runId: 30, attempt: 1 },
      }),
    )
    expect(recorded).toEqual({
      kind: 'apply',
      transition: {
        next: repository(draft, {
          revision: 5,
          lastCiRun: { runId: 30, attempt: 1 },
        }),
        revoke: { kind: 'none' },
      },
    })
    const next = recorded.kind === 'apply' ? recorded.transition.next : null
    expect(next && decideCi(next, ci({ startRevision: 4 }))).toEqual({
      kind: 'skip',
      reason: 'older_run',
    })
  })

  test('Given a manual deck switched to repository mode, When a run started before the switch finishes, Then it is stale', () => {
    const switched = decideAuthor(
      deck(draft),
      { kind: 'set_mode', mode: 'repository' },
      4,
    )
    const next = switched.kind === 'apply' ? switched.transition.next : null
    expect(next && decideCi(next, ci({ startRevision: 4 }))).toEqual({
      kind: 'skip',
      reason: 'stale_revision',
    })
  })

  test.each([
    ['manual mode', deck(publicA), ci(), 'manual_mode'],
    [
      'a start revision ahead of the deck',
      repository(publicA),
      ci({ startRevision: 9 }),
      'stale_revision',
    ],
    ['no intent', repository(publicA), ci({ intent: null }), 'no_intent'],
    ['a pause', repository({ kind: 'paused', resumeTo: 'a' }), ci(), 'paused'],
    [
      'a run started during the pause',
      repository({ kind: 'paused', resumeTo: 'a' }, { authorRevision: 4 }),
      ci({ startRevision: 4 }),
      'paused',
    ],
    [
      'an author operation after the start',
      repository(publicA, { authorRevision: 5, revision: 5 }),
      ci(),
      'stale_revision',
    ],
    [
      'a resume after a run started during the pause',
      repository(publicA, { authorRevision: 5, revision: 5 }),
      ci({ startRevision: 4 }),
      'stale_revision',
    ],
    [
      'an upload from before F02',
      repository(publicA),
      ci({ startRevision: null }),
      'stale_revision',
    ],
  ] as const)(
    'Given %s, When a run finishes, Then publication is unchanged',
    (_, current, run, reason) => {
      expect(decideCi(current, run)).toEqual({ kind: 'skip', reason })
    },
  )
})
