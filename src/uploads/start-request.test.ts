import { describe, expect, it } from 'vitest'
import { attemptSchema, parseStartRequest, versionKey } from './start-request'

const files = [{ path: 'index.html', size: 1, sha256: 'a'.repeat(64) }]

describe('parseStartRequest', () => {
  it('Given a start with an attempt, When parsed, Then the attempt is taken out and the rest is left for the inventory parser', () => {
    expect(
      parseStartRequest({
        attempt: 'k3Jx_-0123456789',
        entry: 'index.html',
        files,
      }),
    ).toEqual({
      attempt: 'k3Jx_-0123456789',
      inventory: { entry: 'index.html', files },
    })
  })

  it.each([
    ['a UUID', '2f1c7d2e-8a53-4a0b-9a57-0d1f4c0f6b11'],
    ['16 characters', 'a'.repeat(16)],
    ['64 characters', 'A1_-'.repeat(16)],
  ])('Given %s as the attempt, When parsed, Then it is accepted', (_, id) => {
    expect(parseStartRequest({ attempt: id }).attempt).toBe(id)
  })

  it.each([
    ['none', undefined],
    ['an empty one', ''],
    ['15 characters', 'a'.repeat(15)],
    ['65 characters', 'a'.repeat(65)],
    ['a colon, which separates the parts of a key', `${'a'.repeat(16)}:b`],
    ['a slash', `${'a'.repeat(16)}/b`],
    ['a space', `${'a'.repeat(16)} `],
    ['a line break', `${'a'.repeat(16)}\n`],
    ['markup', '<script>alert(1)</script>'],
    ['an emoji', `${'a'.repeat(16)}😀`],
    ['a number', 1234567890123456],
    ['null', null],
    ['a list', ['a'.repeat(16)]],
  ])('Given %s as the attempt, When parsed, Then it throws', (_, attempt) => {
    expect(() =>
      parseStartRequest({ attempt, entry: 'index.html', files }),
    ).toThrow()
  })

  it.each([
    ['null', null],
    ['a list', [{ attempt: 'a'.repeat(16) }]],
    ['text', 'a'.repeat(16)],
    ['a number', 1],
    ['nothing', undefined],
  ])('Given %s as the whole start, When parsed, Then it throws', (_, input) => {
    expect(() => parseStartRequest(input)).toThrow()
  })

  it('Given keys the inventory does not know, When parsed, Then they stay in the inventory for its parser to refuse', () => {
    const start = parseStartRequest({
      attempt: 'a'.repeat(16),
      publication: { published: true },
    })

    expect(start.inventory).toEqual({ publication: { published: true } })
  })
})

describe('versionKey', () => {
  it('Given one attempt for two decks, When keys are made, Then they differ', () => {
    const attempt = attemptSchema.parse('a'.repeat(16))

    expect(versionKey('deck-a', attempt)).toBe(`deck-a:${'a'.repeat(16)}`)
    expect(versionKey('deck-a', attempt)).not.toBe(
      versionKey('deck-b', attempt),
    )
  })

  it('Given a deck key that is the start of another, When keys are made, Then an attempt cannot make them collide', () => {
    // Neither a deck key nor an attempt can hold the separator.
    const attempt = attemptSchema.parse('b-cccccccccccccccc')

    expect(versionKey('a', attempt)).not.toBe(
      versionKey('a-b', attemptSchema.parse('cccccccccccccccc')),
    )
  })
})
