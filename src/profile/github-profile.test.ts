import { expect, test } from 'vitest'
import {
  avatarUrlOf,
  profileOfGitHub,
  sponsorsUrl,
  websiteLabel,
  websiteOf,
} from './github-profile'

test('Given a full GitHub profile, When it is read, Then the shown fields are kept and the rest is dropped', () => {
  expect(
    profileOfGitHub('kobaken', {
      login: 'someone-else',
      name: ' Kenta Kobayashi ',
      avatar_url: 'https://avatars.githubusercontent.com/u/722500?v=4',
      location: 'Tokyo',
      blog: 'https://kobaken.co',
      bio: 'not shown',
      email: 'not@shown.example',
    }),
  ).toEqual({
    login: 'kobaken',
    name: 'Kenta Kobayashi',
    avatarUrl: 'https://avatars.githubusercontent.com/u/722500?v=4',
    location: 'Tokyo',
    website: 'https://kobaken.co/',
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
