import { describe, expect, test } from 'vitest'
import {
  ENTER_LIFETIME_SECONDS,
  PASS_LIFETIME_SECONDS,
  signPass,
  usableSecret,
  verifyPass,
} from './pass-token'

const SECRET = 'a-secret-the-service-already-has-0000'
const HELD = 'on;until=2026-12-01T03:00:00Z;reason=database'
const NOW = 1_800_000_000

describe('F38-AC19: the values of the entrance', () => {
  test('Given the lifetimes, When read, Then a value in an address lasts a minute and a pass an hour', () => {
    expect(ENTER_LIFETIME_SECONDS).toBe(60)
    expect(PASS_LIFETIME_SECONDS).toBe(3600)
  })

  test.each(['enter', 'pass'] as const)(
    'Given a %s value, When it is checked at once, Then it holds, until its last second',
    async (kind) => {
      const { value, expiresAt } = await signPass(SECRET, kind, HELD, NOW)
      expect(value).toMatch(/^v1\.(enter|pass)\.\d+\.[A-Za-z0-9_-]{43}$/)
      expect(expiresAt).toBe(
        NOW +
          (kind === 'enter' ? ENTER_LIFETIME_SECONDS : PASS_LIFETIME_SECONDS),
      )
      expect(await verifyPass(SECRET, value, kind, HELD, NOW)).toBe(true)
      expect(await verifyPass(SECRET, value, kind, HELD, expiresAt - 1)).toBe(
        true,
      )
      expect(await verifyPass(SECRET, value, kind, HELD, expiresAt)).toBe(false)
      expect(await verifyPass(SECRET, value, kind, HELD, expiresAt + 1)).toBe(
        false,
      )
    },
  )

  test('Given an enter value, When it is shown as a pass, or a pass as an enter value, Then neither holds', async () => {
    const enter = (await signPass(SECRET, 'enter', HELD, NOW)).value
    const pass = (await signPass(SECRET, 'pass', HELD, NOW)).value
    expect(await verifyPass(SECRET, enter, 'pass', HELD, NOW)).toBe(false)
    expect(await verifyPass(SECRET, pass, 'enter', HELD, NOW)).toBe(false)
    // Relabelled by hand: the signature covers the kind.
    const relabelled = enter.replace('.enter.', '.pass.')
    expect(await verifyPass(SECRET, relabelled, 'pass', HELD, NOW)).toBe(false)
  })

  test('Given a value, When any part of it is changed, Then it does not hold', async () => {
    const { value } = await signPass(SECRET, 'pass', HELD, NOW)
    const [v, kind, expiry, signature] = value.split('.') as [
      string,
      string,
      string,
      string,
    ]
    const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1)
    for (const changed of [
      `${v}.${kind}.${Number(expiry) + 1}.${signature}`,
      `${v}.${kind}.${Number(expiry) - 1}.${signature}`,
      `${v}.${kind}.${expiry}.${flipped}`,
      `${v}.${kind}.${expiry}.${signature.slice(0, -1)}`,
      `v2.${kind}.${expiry}.${signature}`,
      `${value}.extra`,
      ` ${value}`,
      `${value} `,
      `${value}\n`,
    ])
      expect(
        await verifyPass(SECRET, changed, 'pass', HELD, NOW),
        changed,
      ).toBe(false)
  })

  test('Given a pass whose expiry has a leading zero, When its signature is right for the number, Then it is refused', async () => {
    const { value, expiresAt } = await signPass(SECRET, 'pass', HELD, NOW)
    const [v, kind, , signature] = value.split('.') as [
      string,
      string,
      string,
      string,
    ]
    expect(await verifyPass(SECRET, value, 'pass', HELD, NOW)).toBe(true)
    for (const zeros of ['0', '00', '000'])
      expect(
        await verifyPass(
          SECRET,
          `${v}.${kind}.${zeros}${expiresAt}.${signature}`,
          'pass',
          HELD,
          NOW,
        ),
        zeros,
      ).toBe(false)
  })

  test('Given a pass whose last signature character is another spelling of the same bytes, When it is checked, Then it is refused', async () => {
    const { value } = await signPass(SECRET, 'pass', HELD, NOW)
    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    const last = value.at(-1)!
    // 43 characters carry 258 bits for 256: the last one has 2 spare bits, so
    // the three others that share its top 4 bits decode to the same bytes.
    const index = alphabet.indexOf(last)
    const siblings = [...alphabet].filter(
      (c, i) => c !== last && i >> 2 === index >> 2,
    )
    expect(siblings).toHaveLength(3)
    for (const sibling of siblings)
      expect(
        await verifyPass(
          SECRET,
          value.slice(0, -1) + sibling,
          'pass',
          HELD,
          NOW,
        ),
        sibling,
      ).toBe(false)
  })

  test('Given a value made far too long-lived, When its signature is right, Then it is still refused', async () => {
    // A value of a minute cannot be made to last for a day, even by the service
    // itself: the check holds the value to the life of its kind.
    const { value } = await signPass(SECRET, 'enter', HELD, NOW + 86_400)
    expect(await verifyPass(SECRET, value, 'enter', HELD, NOW)).toBe(false)
  })

  test.each([
    ['another secret', 'another-secret-0000000000000', HELD],
    ['another maintenance', SECRET, 'on'],
    [
      'the same maintenance with another end',
      SECRET,
      'on;until=2026-12-02T03:00:00Z;reason=database',
    ],
    ['an empty maintenance', SECRET, ''],
  ])(
    'Given a value made for one maintenance, When it is checked against %s, Then it does not hold',
    async (_, secret, held) => {
      const { value } = await signPass(SECRET, 'pass', HELD, NOW)
      expect(await verifyPass(secret, value, 'pass', held, NOW)).toBe(false)
    },
  )

  test.each([
    undefined,
    '',
    'v1',
    'v1.pass.1.x',
    'v1.pass..AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'v1.pass.99999999999999999999.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    `v1.pass.${NOW + 1}.${'A'.repeat(43)}`,
    `v1.pass.${NOW + 1}.${'!'.repeat(43)}`,
    'あ'.repeat(100),
    'x'.repeat(100_000),
    '<script>alert(1)</script>',
  ])(
    'Given the value %j, When it is checked, Then it does not hold and nothing is thrown',
    async (value) => {
      expect(await verifyPass(SECRET, value, 'pass', HELD, NOW)).toBe(false)
    },
  )

  test('Given the same inputs twice, When values are made, Then they are the same, and a different time makes a different one', async () => {
    const a = await signPass(SECRET, 'pass', HELD, NOW)
    expect((await signPass(SECRET, 'pass', HELD, NOW)).value).toBe(a.value)
    expect((await signPass(SECRET, 'pass', HELD, NOW + 1)).value).not.toBe(
      a.value,
    )
  })

  test('Given the key, When the secret itself is used as the signature, Then it holds nothing: the key is derived, not the secret', async () => {
    const { value } = await signPass(SECRET, 'pass', HELD, NOW)
    expect(value).not.toContain(SECRET)
  })

  test.each([
    [undefined, false],
    ['', false],
    ['short', false],
    ['a'.repeat(15), false],
    ['a'.repeat(16), true],
    [SECRET, true],
  ])(
    'Given the secret %j, When it is judged, Then it is usable: %s',
    (secret, ok) => {
      expect(usableSecret(secret)).toBe(ok)
    },
  )
})
