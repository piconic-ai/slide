import { describe, expect, test } from 'vitest'
import {
  checkProfile,
  fieldsOfForm,
  type ProfileFields,
  type ProfileProblem,
} from './profile-input'

const valid: ProfileFields = {
  name: 'Kenta',
  bio: '',
  location: '',
  website: '',
  links: [],
  useGravatar: true,
}
const check = (changes: Partial<ProfileFields>) =>
  checkProfile({ ...valid, ...changes })
const problemsOf = (changes: Partial<ProfileFields>): ProfileProblem[] => {
  const result = check(changes)
  if (result.kind === 'valid') throw new Error('expected problems')
  return [...result.problems]
}

describe('F28-AC36: the display name is required', () => {
  test.each(['', '   ', '　　', '​', '\n\t', '‮'])(
    'Given the name %j, When it is checked, Then it is refused as empty',
    (name) => {
      expect(problemsOf({ name })).toEqual([{ field: 'name', reason: 'empty' }])
    },
  )
})

describe('F28-AC37: lengths are counted in characters and the longest is kept', () => {
  test.each([
    ['name', 50, 'a'],
    ['bio', 160, 'あ'],
    ['location', 50, '😀'],
  ] as const)(
    'Given a %s of exactly %i characters, When it is checked, Then it is saved whole, and one more is refused',
    (field, max, unit) => {
      const exact = unit.repeat(max)
      const saved = check({ [field]: exact })
      expect(saved).toMatchObject({
        kind: 'valid',
        profile: { [field]: exact },
      })
      expect(problemsOf({ [field]: `${exact}${unit}` })).toEqual([
        { field, reason: 'too_long' },
      ])
    },
  )

  test('Given a name of 50 emoji, When it is checked, Then each counts as one although each takes two code units', () => {
    expect(check({ name: '😀'.repeat(50) }).kind).toBe('valid')
  })

  test('Given every field over its limit, When it is checked, Then every problem is reported at once', () => {
    expect(
      problemsOf({
        name: 'a'.repeat(51),
        bio: 'a'.repeat(161),
        location: 'a'.repeat(51),
      }),
    ).toEqual([
      { field: 'name', reason: 'too_long' },
      { field: 'bio', reason: 'too_long' },
      { field: 'location', reason: 'too_long' },
    ])
  })

  test('Given a bio of 160 characters plus the spaces around it, When it is checked, Then the spaces do not count', () => {
    expect(check({ bio: `  ${'a'.repeat(160)}  ` }).kind).toBe('valid')
  })
})

describe('F28-AC38: addresses must be https', () => {
  test.each([
    ['http://example.com', 'not_https'],
    ['javascript:alert(1)', 'not_https'],
    ['data:text/html,x', 'not_https'],
    ['ftp://example.com', 'not_https'],
    ['example.com', 'invalid'],
    ['https://', 'invalid'],
    ['https://localhost', 'invalid'],
    ['https://user:pass@example.com', 'invalid'],
    ['https://example.com/' + 'a'.repeat(2048), 'too_long'],
  ] as const)(
    'Given the website %j, When it is checked, Then it is refused as %s',
    (website, reason) => {
      expect(problemsOf({ website: website.slice(0, 2200) })).toEqual([
        { field: 'website', reason },
      ])
    },
  )

  test('Given an https link in the social links, When it is checked, Then a bad one is refused by its position', () => {
    expect(
      problemsOf({ links: ['https://bsky.app/profile/a', 'http://x.com/a'] }),
    ).toEqual([{ field: 'link', index: 1, reason: 'not_https' }])
  })

  test('Given a good address, When it is checked, Then it is stored in the parsed form with its spaces taken off', () => {
    expect(check({ website: '  https://Example.com  ' })).toMatchObject({
      kind: 'valid',
      profile: { website: 'https://example.com/' },
    })
  })
})

describe('F28-AC39: at most three social links', () => {
  const link = (n: number) => `https://example.com/${n}`
  test('Given three links, When they are checked, Then all are kept in order', () => {
    expect(check({ links: [link(1), link(2), link(3)] })).toMatchObject({
      kind: 'valid',
      profile: { links: [link(1), link(2), link(3)] },
    })
  })
  test('Given four links, When they are checked, Then they are refused as too many', () => {
    expect(problemsOf({ links: [1, 2, 3, 4].map(link) })).toContainEqual({
      field: 'links',
      reason: 'too_many',
    })
  })
  test('Given empty fields between three links, When they are checked, Then the empty ones do not count and the rest keep their order', () => {
    expect(
      check({ links: ['', link(1), '  ', link(2), link(3), ''] }),
    ).toMatchObject({
      kind: 'valid',
      profile: { links: [link(1), link(2), link(3)] },
    })
  })
})

describe('F28-AC40: a bio is text, however it is written', () => {
  test('Given a bio with HTML, When it is checked, Then the markup is kept as the characters typed', () => {
    const bio = '<script>alert(1)</script> <b>hi</b>'
    expect(check({ bio })).toMatchObject({ kind: 'valid', profile: { bio } })
  })
  test('Given line breaks of every kind, When the bio is checked, Then each is one line break and long runs become a blank line (provisional)', () => {
    expect(check({ bio: 'a\r\nb\rc d\n\n\n\ne' })).toMatchObject({
      profile: { bio: 'a\nb\nc\nd\n\ne' },
    })
  })
  test('Given direction marks and zero-width spaces in a name, When it is checked, Then they become spaces, but an emoji sequence keeps its joiners', () => {
    expect(check({ name: 'a‮b​c 👨‍👩‍👧' })).toMatchObject({
      profile: { name: 'a b c 👨‍👩‍👧' },
    })
  })
  test('Given a lone surrogate, When the name is checked, Then it becomes U+FFFD', () => {
    expect(check({ name: 'a\ud800b' })).toMatchObject({
      profile: { name: 'a�b' },
    })
  })
})

describe('F28-AC35: an empty optional field is stored as nothing', () => {
  test('Given only a name, When it is checked, Then every other field is null or empty', () => {
    expect(check({})).toEqual({
      kind: 'valid',
      profile: {
        name: 'Kenta',
        bio: null,
        location: null,
        website: null,
        links: [],
        useGravatar: true,
      },
    })
  })
})

describe('fieldsOfForm reads a posted form without trusting it', () => {
  test('Given missing, repeated and non-text fields, When they are read, Then they become text, and links keep every value', () => {
    const fields = fieldsOfForm(
      { name: new File(['x'], 'x'), link: ['a', 'b'], bio: 'ok' },
      false,
    )
    expect(fields).toEqual({
      name: '',
      bio: 'ok',
      location: '',
      website: '',
      links: ['a', 'b'],
      useGravatar: false,
    })
    expect(fieldsOfForm({ link: 'one' }, true).links).toEqual(['one'])
  })
  test('Given a huge body, When it is read, Then the text is cut but still over its limit, and at most 50 links are read', () => {
    const fields = fieldsOfForm(
      { name: 'a'.repeat(1_000_000), link: Array(500).fill('https://a.b') },
      true,
    )
    expect(fields.name.length).toBeLessThan(20_000)
    expect(fields.links).toHaveLength(50)
    expect(checkProfile(fields).kind).toBe('invalid')
  })
})
