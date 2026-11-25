import { describe, expect, test } from 'vitest'
import type { DeckPublication, Publication } from './state'
import { decideAuthor } from './transitions'

const deck = (
  publication: Publication,
  overrides: Partial<DeckPublication> = {},
): DeckPublication => ({
  publication,
  revision: 4,
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
        next: deck({ kind: 'public', deploymentId: 'b' }, { revision: 5 }),
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

  test('Given another tab published B after the author looked at A, When the author pauses from the older view, Then B is stopped too', () => {
    const decision = decideAuthor(
      deck({ kind: 'public', deploymentId: 'b' }, { revision: 5 }),
      { kind: 'pause' },
      4,
    )
    expect(decision).toEqual({
      kind: 'apply',
      transition: {
        next: deck({ kind: 'paused', resumeTo: 'b' }, { revision: 6 }),
        revoke: { kind: 'deck' },
      },
    })
  })

  test('Given A is public, When paused, Then nothing is public, A is remembered and all owner sessions end', () => {
    expect(decideAuthor(deck(publicA), { kind: 'pause' }, 4)).toEqual({
      kind: 'apply',
      transition: {
        next: deck({ kind: 'paused', resumeTo: 'a' }, { revision: 5 }),
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
      next: deck(publicA, { revision: 5 }),
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
      'pausing a paused deck that has nothing to resume',
      deck({ kind: 'paused', resumeTo: null }),
      { kind: 'pause' },
    ],
  ] as const)(
    'Given %s, When requested, Then nothing changes',
    (_, current, command) => {
      expect(decideAuthor(current, command, 4)).toEqual({ kind: 'unchanged' })
    },
  )
})
