import { expect, test } from 'vitest'
import {
  avatarUrlOf,
  bioOf,
  profileOfGitHub,
  sponsorsUrl,
  websiteLabel,
  websiteOf,
} from './github-profile'

test('Given a full GitHub profile, When it is read, Then the shown fields, bio included, are kept and the rest is dropped', () => {
  expect(
    profileOfGitHub('kobaken', {
      login: 'someone-else',
      name: ' Kenta Kobayashi ',
      avatar_url: 'https://avatars.githubusercontent.com/u/722500?v=4',
      location: 'Tokyo',
      blog: 'https://kobaken.co',
      bio: ' Speaker\nand writer ',
      email: 'not@shown.example',
    }),
  ).toEqual({
    login: 'kobaken',
    name: 'Kenta Kobayashi',
    avatarUrl: 'https://avatars.githubusercontent.com/u/722500?v=4',
    location: 'Tokyo',
    website: 'https://kobaken.co/',
    bio: 'Speaker and writer',
  })
})

test.each([
  [null],
  [undefined],
  ['not an object'],
  [{}],
  [{ name: '', location: '   ', blog: '', avatar_url: null }],
  [{ name: 1, location: {}, blog: [], avatar_url: 2 }],
  [{ name: 'n'.repeat(256), location: 'l'.repeat(256) }],
])(
  'Given GitHub answers %j, When it is read, Then only the login is left',
  (data) => {
    expect(profileOfGitHub('owner', data)).toEqual({
      login: 'owner',
      name: null,
      avatarUrl: null,
      location: null,
      website: null,
      bio: null,
    })
  },
)

test.each([
  ['https://avatars.githubusercontent.com/u/1?v=4', true],
  ['http://avatars.githubusercontent.com/u/1', false],
  ['https://avatars.githubusercontent.com.evil.example/u/1', false],
  ['https://evil.example/avatars.githubusercontent.com/u/1', false],
  ['https://avatars.githubusercontent.com:8443/u/1', false],
  ['javascript:alert(1)', false],
  ['data:image/png;base64,AAAA', false],
  ['', false],
  [`https://avatars.githubusercontent.com/${'a'.repeat(2048)}`, false],
])('Given the image URL %j, When checked, Then shown is %j', (url, shown) => {
  expect(avatarUrlOf(url) !== null).toBe(shown)
})

test.each([
  ['https://kobaken.co', 'https://kobaken.co/'],
  ['http://example.com/me', 'http://example.com/me'],
  ['kobaken.co', 'https://kobaken.co/'],
  ['example.com/a?b=c', 'https://example.com/a?b=c'],
  ['  example.com  ', 'https://example.com/'],
  ['javascript:alert(1)', null],
  ['data:text/html,<script>alert(1)</script>', null],
  ['mailto:someone@example.com', null],
  ['ftp://example.com', null],
  ['ssh://git.example.com/x', null],
  ['tel:+81.3', null],
  ['example.com:8080/x', 'https://example.com:8080/x'],
  ['HTTPS://Example.com', 'https://example.com/'],
  ['https://user:pass@example.com', null],
  ['localhost', null],
  ['not a site', null],
  ['', null],
  [null, null],
  [`example.com/${'a'.repeat(240)}`, `https://example.com/${'a'.repeat(240)}`],
  [`example.com/${'a'.repeat(2048)}`, null],
  // Written out, each of these letters takes nine characters.
  [`example.com/${'あ'.repeat(240)}`, null],
])('Given the site %j, When read as a link, Then it is %j', (blog, link) => {
  expect(websiteOf(blog)).toBe(link)
})

test.each([
  ['kobaken.co'],
  [`example.com/${'a'.repeat(240)}`],
  [`example.com/${'あ'.repeat(200)}`],
  ['example.com:8080/x?y=z#w'],
])(
  'Given the site %j was kept, When the kept link is read again, Then it is the same link',
  (blog) => {
    const kept = websiteOf(blog)
    expect(kept).not.toBeNull()
    expect(kept?.length).toBeLessThanOrEqual(2048)
    expect(websiteOf(kept)).toBe(kept)
  },
)

test('Given a name and a place holding control characters, When the profile is read, Then they are read as spaces', () => {
  expect(
    profileOfGitHub('owner', {
      name: '\u0000Ken\nta\u0000',
      location: '\u0000',
    }),
  ).toMatchObject({ name: 'Ken ta', location: null })
})

test('Given a site, When it is labelled, Then the host is shown, and the path when there is one', () => {
  expect(websiteLabel('https://kobaken.co/')).toBe('kobaken.co')
  expect(websiteLabel('https://example.com/me')).toBe('example.com/me')
})

test('Given a login, When the Sponsors page is linked, Then it is the one GitHub serves for that login', () => {
  expect(sponsorsUrl('kobaken')).toBe('https://github.com/sponsors/kobaken')
})

test.each([
  [null, null],
  [undefined, null],
  [12, null],
  ['', null],
  [' \r\n\n ', null],
  ['hello', 'hello'],
  ['<script>alert(1)</script>', '<script>alert(1)</script>'],
  ['https://example.com', 'https://example.com'],
  ['a\nb', 'a b'],
  ['a\r\nb', 'a b'],
  ['a\rb', 'a b'],
  ['a\n\n\r\nb', 'a b'],
])(
  'F21-AC30, F21-AC31: Given a bio %j, When it is read, Then it is %j',
  (value, expected) => {
    expect(bioOf(value)).toBe(expected)
  },
)

test('F21-AC29: Given bios of 159, 160 and 161 code points, When they are read, Then only the 161st is cut, with no mark', () => {
  expect(bioOf('x'.repeat(159))).toBe('x'.repeat(159))
  expect(bioOf('x'.repeat(160))).toBe('x'.repeat(160))
  expect(bioOf('x'.repeat(161))).toBe('x'.repeat(160))
})

test('F21-AC29: Given a bio of astral characters, When it is read, Then it is counted in code points, not UTF-16 units', () => {
  const emoji = '\u{1F600}'
  expect(bioOf(emoji.repeat(160))).toBe(emoji.repeat(160))
  expect(bioOf(emoji.repeat(161))).toBe(emoji.repeat(160))
})

test('F21-AC29, F21-AC30: Given line breaks that make a bio longer than 160 only before they are merged, When it is read, Then they are merged first and the cut follows', () => {
  expect(bioOf(`${'x'.repeat(159)}\r\n\r\n${'y'.repeat(5)}`)).toBe(
    'x'.repeat(159),
  )
  expect(bioOf(`${'x'.repeat(160)}\n`)).toBe('x'.repeat(160))
})

test.each([
  ['a\u202Eb', 'a b'],
  ['a\u2066b\u2069c', 'a b c'],
  ['a\u200Bb\u200C\u200D\u2060\uFEFFc', 'a b    c'],
  ['\u200B\u200D\uFEFF', null],
  ['\u202E\u2066', null],
  ['a\u0085b', 'a b'],
  ['a\u2028b\u2029\u2028c', 'a b c'],
  ['a\u0000b\u007fc', 'a b c'],
])(
  'F21-AC30, F21-AC31: Given a bio %j with hidden or separator characters, When it is read, Then they are spaces: %j',
  (value, expected) => {
    expect(bioOf(value)).toBe(expected)
  },
)

test('F21-AC29: Given a lone surrogate in a bio, a name and a place, When they are read, Then each is well formed text', () => {
  expect(bioOf('a\uD800b')).toBe('a\uFFFDb')
  const profile = profileOfGitHub('o', {
    name: 'n\uDC00',
    location: '\uD800',
    bio: 'x\uD83D',
  })
  for (const value of [profile.name, profile.location, profile.bio])
    expect(value?.isWellFormed()).toBe(true)
})

test('F21-AC29: Given a cut that leaves a space at the end, When it is read, Then no trailing space is kept', () => {
  expect(bioOf(`${'x'.repeat(159)} y`)).toBe('x'.repeat(159))
  expect(bioOf(`${'x'.repeat(160)} `)).toBe('x'.repeat(160))
})

test('F21-AC29: Given a very long bio, When it is read, Then only its start is read and it is cut at 160', () => {
  const huge = `${' '.repeat(5000)}tail`
  expect(bioOf(huge)).toBeNull()
  expect(bioOf('y'.repeat(1_000_000))).toBe('y'.repeat(160))
})
