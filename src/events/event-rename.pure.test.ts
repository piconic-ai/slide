import { describe, expect, test } from 'vitest'
import {
  mayRenameEvent,
  parseEventName,
  parseEventTarget,
} from './event-rename'

const ORIGIN = 'https://slide.example'

describe('parseEventTarget', () => {
  test.each([
    ['12', 12],
    [' 12 ', 12],
    ['/events/12', 12],
    ['/events/12/', 12],
    [`${ORIGIN}/events/12`, 12],
    [`${ORIGIN}/events/12?x=1#y`, 12],
    ['0', null],
    ['012', null],
    ['-1', null],
    ['1e3', null],
    ['', null],
    ['/events/', null],
    ['/events/12/edit', null],
    ['https://evil.example/events/12', null],
    ['@owner/talk', null],
    ['9'.repeat(17), null],
  ] as const)(
    'F29-AC15: Given %j, When the operator names an event with it, Then it is %s',
    (input, expected) => {
      expect(parseEventTarget(input, ORIGIN)).toBe(expected)
    },
  )

  test('F29-AC15: Given something that is not text, When it names an event, Then it names none', () => {
    expect(parseEventTarget(undefined, ORIGIN)).toBeNull()
    expect(parseEventTarget(12, ORIGIN)).toBeNull()
  })
})

describe('parseEventName', () => {
  test.each([
    [' Kanagawa.pm #3 ', 'Kanagawa.pm #3'],
    ['🎉'.repeat(100), '🎉'.repeat(100)],
    ['x'.repeat(101), null],
    ['', null],
    ['   ', null],
    ['　', null],
    ['a​b', null],
    ['a\nb', null],
    [undefined, null],
  ])(
    'F29-AC15: Given the name %j, When it is read, Then it is %j',
    (input, expected) => {
      expect(parseEventName(input)).toBe(expected)
    },
  )
})

describe('mayRenameEvent', () => {
  test('F29-AC15: Given the operator and a person who runs no community, When they ask to rename, Then only the operator may', () => {
    expect(mayRenameEvent({ kind: 'operator' }, new Set())).toBe(true)
    expect(mayRenameEvent({ kind: 'person', userId: 'u1' }, new Set())).toBe(
      false,
    )
    expect(
      mayRenameEvent({ kind: 'person', userId: 'u1' }, new Set(['u2'])),
    ).toBe(false)
    expect(
      mayRenameEvent({ kind: 'person', userId: 'u1' }, new Set(['u1'])),
    ).toBe(true)
  })
})
