import { describe, expect, test } from 'vitest'
import {
  addressOf,
  columnsFor,
  EmailCryptoError,
  hashedIdentifier,
  isPlaceholder,
  lookupOf,
  openEmail,
  parseEmailCrypto,
  partsOfSealed,
  placeholderOf,
  sealEmail,
  storedIdentifier,
  storedForms,
  type EmailCrypto,
} from './email-cipher'

const b64 = (seed: number) =>
  btoa(String.fromCharCode(...new Uint8Array(32).fill(seed)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')

const KEY1 = b64(1)
const KEY2 = b64(2)
const LOOKUP = b64(9)

const on = (settings: Parameters<typeof parseEmailCrypto>[0] = {}) =>
  parseEmailCrypto({
    keys: `1:${KEY1}`,
    current: '1',
    lookupKey: LOOKUP,
    ...settings,
  }) as Extract<EmailCrypto, { kind: 'on' }>

const iv = (seed = 7) => new Uint8Array(12).fill(seed)
const codeOf = async (run: () => Promise<unknown>) => {
  try {
    await run()
  } catch (error) {
    return error instanceof EmailCryptoError ? error.code : 'other'
  }
  return 'none'
}

describe('parseEmailCrypto', () => {
  test('F41-AC13: Given none of the three settings, When read, Then the keys are off', () => {
    expect(parseEmailCrypto({})).toEqual({ kind: 'off' })
    expect(
      parseEmailCrypto({ keys: ' ', current: '', lookupKey: '\n' }),
    ).toEqual({ kind: 'off' })
  })

  test('Given a whole setting with two versions, When read, Then both are held and the current one is named', () => {
    const config = on({ keys: `1:${KEY1},2:${KEY2}`, current: '2' })
    expect([...config.keys.keys()]).toEqual([1, 2])
    expect(config.current).toBe(2)
  })

  test.each([
    [
      'only the keys',
      { current: undefined, lookupKey: undefined },
      ['current_missing', 'lookup_missing'],
    ],
    ['no keys', { keys: undefined }, ['keys_missing']],
    [
      'a current version it does not hold',
      { current: '3' },
      ['current_unknown'],
    ],
    [
      'a current version that is not a number',
      { current: 'x' },
      ['current_unknown'],
    ],
    [
      'a key that is too short',
      { keys: `1:${KEY1.slice(0, 20)}` },
      ['keys_malformed'],
    ],
    [
      'a key with a character outside base64url',
      { keys: `1:${KEY1.slice(0, 42)}+/=` },
      ['keys_malformed'],
    ],
    ['a repeated version', { keys: `1:${KEY1},1:${KEY2}` }, ['keys_malformed']],
    ['version zero', { keys: `0:${KEY1}`, current: '0' }, ['keys_malformed']],
    ['a version with a sign', { keys: `+1:${KEY1}` }, ['keys_malformed']],
    [
      'a version past the limit',
      { keys: `10000:${KEY1}`, current: '10000' },
      ['keys_malformed'],
    ],
    ['an extra field', { keys: `1:${KEY1}:x` }, ['keys_malformed']],
    ['an empty entry', { keys: `1:${KEY1},` }, ['keys_malformed']],
    [
      'a lookup key that is too short',
      { lookupKey: 'abc' },
      ['lookup_malformed'],
    ],
    [
      'a lookup key that is also an encryption key',
      { lookupKey: KEY1 },
      ['lookup_reused'],
    ],
  ])(
    'Given %s, When read, Then it is invalid and says why, never what',
    (_name, settings, problems) => {
      const config = parseEmailCrypto({
        keys: `1:${KEY1}`,
        current: '1',
        lookupKey: LOOKUP,
        ...settings,
      })
      expect(config).toEqual({ kind: 'invalid', problems })
      expect(JSON.stringify(config)).not.toContain(KEY1)
      expect(JSON.stringify(config)).not.toContain(LOOKUP)
    },
  )
})

describe('sealing', () => {
  test('F41-AC1: Given an address, When sealed, Then the text names no part of the address', async () => {
    const sealed = await sealEmail(on(), 'Alice@Example.com', iv())
    expect(sealed.toLowerCase()).not.toContain('alice')
    expect(sealed.toLowerCase()).not.toContain('example')
    expect(sealed).toMatch(/^ec1\.1\.[\w-]{16}\.[\w-]+\.[\w-]{22}$/)
  })

  test('Given the same address, When sealed with two IVs, Then the texts differ and both open to it', async () => {
    const config = on()
    const first = await sealEmail(config, 'a@x.example', iv(1))
    const second = await sealEmail(config, 'a@x.example', iv(2))
    expect(first).not.toBe(second)
    expect(await openEmail(config, first)).toBe('a@x.example')
    expect(await openEmail(config, second)).toBe('a@x.example')
  })

  test('F41-AC2: Given spellings that differ in case and spaces, When sealed and looked up, Then they stand for one address', async () => {
    const config = on()
    const sealed = await sealEmail(config, '  Alice@Example.COM ', iv())
    expect(await openEmail(config, sealed)).toBe('alice@example.com')
    const lookups = await Promise.all(
      [' Alice@Example.com', 'alice@example.com', 'ALICE@EXAMPLE.COM\n'].map(
        (email) => lookupOf(config, email),
      ),
    )
    expect(new Set(lookups).size).toBe(1)
  })

  test('Given the empty address, When sealed, Then it is refused; a very long one and a non-ASCII one open to themselves', async () => {
    const config = on()
    expect(await codeOf(() => sealEmail(config, '  ', iv()))).toBe('malformed')
    for (const email of [`${'a'.repeat(240)}@x.example`, 'ü@例え.jp'])
      expect(
        await openEmail(config, await sealEmail(config, email, iv())),
      ).toBe(email.toLowerCase())
  })

  test('F41-AC14: Given a sealed text with any one bit changed, When opened, Then it is refused', async () => {
    const config = on()
    const sealed = await sealEmail(config, 'a@x.example', iv())
    const [format, version, ivText, body, tag] = sealed.split('.') as string[]
    const flip = (text: string) => {
      const bytes = Uint8Array.from(
        atob(
          text.replaceAll('-', '+').replaceAll('_', '/') +
            '=='.slice(0, (4 - (text.length % 4)) % 4),
        ),
        (c) => c.charCodeAt(0),
      )
      bytes[0] = (bytes[0] ?? 0) ^ 1
      return btoa(String.fromCharCode(...bytes))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, '')
    }
    for (const changed of [
      [format, version, flip(ivText!), body, tag],
      [format, version, ivText, flip(body!), tag],
      [format, version, ivText, body, flip(tag!)],
    ])
      expect(await codeOf(() => openEmail(config, changed.join('.')))).toBe(
        'auth_failed',
      )
  })

  test('F41-AC14: Given a wrong key, When opened, Then it is refused and the error holds no key, text or address', async () => {
    const sealed = await sealEmail(on(), 'a@x.example', iv())
    const wrong = on({ keys: `1:${KEY2}` })
    let caught: unknown
    try {
      await openEmail(wrong, sealed)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(EmailCryptoError)
    const text = `${String(caught)} ${(caught as Error).stack}`
    for (const secret of [KEY1, KEY2, LOOKUP, sealed, 'a@x.example'])
      expect(text).not.toContain(secret)
  })

  test('F41-AC11: Given a version the configuration does not hold, When opened, Then it is refused as unknown', async () => {
    const sealed = await sealEmail(on(), 'a@x.example', iv())
    expect(
      await codeOf(() =>
        openEmail(on({ keys: `2:${KEY2}`, current: '2' }), sealed),
      ),
    ).toBe('unknown_version')
  })

  test.each([
    '',
    'a@x.example',
    'ec1',
    'ec1.1.a.b.c',
    'ec2.1.AAAAAAAAAAAAAAAA.AA.AAAAAAAAAAAAAAAAAAAAAA',
    'ec1.0.AAAAAAAAAAAAAAAA.AA.AAAAAAAAAAAAAAAAAAAAAA',
    'ec1.1.AAAAAAAAAAAAAAAA.AA.AAAAAAAAAAAAAAAAAAAAAA.x',
    'ec1.1.AAAAAAAAAAAAAAAA.A=.AAAAAAAAAAAAAAAAAAAAAA',
  ])('Given %j, When opened, Then it is refused as malformed', async (text) => {
    expect(partsOfSealed(text)).toBeNull()
    expect(await codeOf(() => openEmail(on(), text))).toBe('malformed')
  })

  test('Given keys that are off or invalid, When asked to seal or look up, Then it is refused', async () => {
    for (const config of [
      parseEmailCrypto({}),
      parseEmailCrypto({ keys: 'x' }),
    ]) {
      expect(await codeOf(() => sealEmail(config, 'a@x.example', iv()))).toBe(
        'not_usable',
      )
      expect(await codeOf(() => lookupOf(config, 'a@x.example'))).toBe(
        'not_usable',
      )
      expect(await codeOf(() => hashedIdentifier(config, 'x'))).toBe(
        'not_usable',
      )
    }
  })

  test('Given an IV of the wrong length, When sealing, Then it is refused', async () => {
    expect(
      await codeOf(() => sealEmail(on(), 'a@x.example', new Uint8Array(8))),
    ).toBe('malformed')
  })
})

describe('lookup values', () => {
  test('F41-AC3: Given two addresses, When looked up, Then they differ, are 64 lowercase hex digits and depend on the key', async () => {
    const a = await lookupOf(on(), 'a@x.example')
    const b = await lookupOf(on(), 'b@x.example')
    const other = await lookupOf(on({ lookupKey: b64(8) }), 'a@x.example')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(new Set([a, b, other]).size).toBe(3)
  })

  test('Given the lookup key is not the encryption key, When changing only the encryption key, Then lookups stay', async () => {
    const before = await lookupOf(on(), 'a@x.example')
    const after = await lookupOf(on({ keys: `1:${KEY2}` }), 'a@x.example')
    expect(after).toBe(before)
  })

  test('Given an address and an identifier with the same text, When hashed, Then they do not collide', async () => {
    const config = on()
    const text = 'sign-in-otp-a@x.example'
    const identifier = await hashedIdentifier(config, text)
    expect(identifier).not.toContain('a@x.example')
    expect(identifier).not.toBe(await lookupOf(config, text))
    expect(identifier).not.toBe(await hashedIdentifier(config, `${text}.`))
  })

  test('Given an address, When its placeholder is made, Then it is lowercase, not an address, and fits the invitations CHECK', async () => {
    const placeholder = placeholderOf(await lookupOf(on(), 'a@x.example'))
    expect(placeholder).toBe(placeholder.toLowerCase())
    expect(placeholder.length).toBeLessThanOrEqual(254)
    expect(isPlaceholder(placeholder)).toBe(true)
    expect(isPlaceholder('a@x.example')).toBe(false)
    expect(placeholder).not.toContain('@')
  })

  test('Given the keys on or off, When the stored forms are asked, Then on has the plain and the placeholder', async () => {
    const config = on()
    expect(await storedForms(config, ' A@X.example ')).toEqual([
      'a@x.example',
      placeholderOf(await lookupOf(config, 'a@x.example')),
    ])
    expect(await storedForms({ kind: 'off' }, ' A@X.example ')).toEqual([
      'a@x.example',
    ])
  })
})

describe('rows', () => {
  test('F41-AC8: Given an address, When columns are made with the keys on, Then none holds the address and the row reads back', async () => {
    const config = on()
    const columns = await columnsFor(config, 'Alice@x.example', iv())
    expect(JSON.stringify(columns).toLowerCase()).not.toContain('alice')
    expect(await addressOf(config, columns)).toBe('alice@x.example')
  })

  test('F41-AC13: Given the keys are off, When columns are made, Then the address is kept plain and no sealed text is made', async () => {
    expect(
      await columnsFor({ kind: 'off' }, ' Alice@x.example ', iv()),
    ).toEqual({
      email: 'alice@x.example',
      emailCiphertext: null,
    })
  })

  test('F41-AC6: Given a plain row, When read with the keys on, Then the address is the one stored', async () => {
    expect(
      await addressOf(on(), { email: 'a@x.example', emailCiphertext: null }),
    ).toBe('a@x.example')
  })

  test('Given a sealed text moved to another row, When read, Then it is refused', async () => {
    const config = on()
    const alice = await columnsFor(config, 'alice@x.example', iv())
    const bob = await columnsFor(config, 'bob@x.example', iv(8))
    expect(
      await codeOf(() =>
        addressOf(config, {
          email: bob.email,
          emailCiphertext: alice.emailCiphertext,
        }),
      ),
    ).toBe('mismatch')
  })

  test.each([
    [
      'a placeholder with no sealed text',
      { email: placeholderOf('0'.repeat(64)), emailCiphertext: null },
    ],
    [
      'a sealed text beside a plain address',
      {
        email: 'a@x.example',
        emailCiphertext: 'ec1.1.AAAAAAAAAAAAAAAA.AA.AAAAAAAAAAAAAAAAAAAAAA',
      },
    ],
  ])(
    'Given %s, When read, Then the row is refused as inconsistent',
    async (_name, row) => {
      expect(await codeOf(() => addressOf(on(), row))).toBe('inconsistent')
    },
  )

  test('F41-AC13: Given a sealed row and the keys off, When read, Then it is refused, never shown as the placeholder', async () => {
    const columns = await columnsFor(on(), 'a@x.example', iv())
    expect(await codeOf(() => addressOf({ kind: 'off' }, columns))).toBe(
      'not_usable',
    )
  })

  test('F41-AC11: Given a row sealed under version 1, When the keys hold 1 and 2 and 2 is current, Then it still reads and a new row is sealed as 2', async () => {
    const old = await columnsFor(on(), 'a@x.example', iv())
    const rotated = on({ keys: `1:${KEY1},2:${KEY2}`, current: '2' })
    expect(await addressOf(rotated, old)).toBe('a@x.example')
    const fresh = await columnsFor(rotated, 'a@x.example', iv())
    expect(fresh.emailCiphertext?.split('.')[1]).toBe('2')
    expect(fresh.email).toBe(old.email)
  })
})

describe('stored identifiers', () => {
  test('F41-AC1: Given the keys on or off, When a code identifier is stored, Then on hides the address and off keeps it', async () => {
    const id = 'sign-in-otp-a@x.example'
    expect(await storedIdentifier({ kind: 'off' }, id)).toBe(id)
    const hidden = await storedIdentifier(on(), id)
    expect(hidden).not.toContain('x.example')
    expect(hidden).toBe(await hashedIdentifier(on(), id))
    expect(
      await codeOf(() => storedIdentifier(parseEmailCrypto({ keys: 'x' }), id)),
    ).toBe('not_usable')
  })
})
