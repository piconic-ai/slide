import { expect, test } from 'vitest'
import { profileCard } from './pages'

const profile = {
  name: 'Kenta',
  avatarUrl: null,
  location: null,
  website: null,
  links: [],
  bio: null,
  useGravatar: true,
}

test('Given a profile without a picture, When the card is rendered, Then the first letter of the name stands in and no color block is used', () => {
  const card = String(profileCard('kfly8', profile, 'en'))
  expect(card).toContain('portrait-initial')
  expect(card).toContain('>K</span')
  expect(card).not.toContain('color-block')
  expect(card).not.toContain('<img')
})

test('Given a profile with a picture, When the card is rendered, Then the picture lies over the letter, which stays for when it cannot be read', () => {
  const card = String(
    profileCard('kfly8', { ...profile, avatarUrl: '/faces/1' }, 'ja'),
  )
  expect(card).toContain('<img')
  expect(card).toContain('portrait-initial')
  expect(card).toContain('data-cover')
})

test('F21-AC60: Given a profile with only a name, When the card is rendered, Then there is no bio, no facts row and no link', () => {
  const card = String(profileCard('kfly8', profile, 'en'))
  expect(card).not.toContain('profile-bio')
  expect(card).not.toContain('fact-name')
  expect(card).not.toContain('<a')
})

test('F21-AC58: Given a website and two social links, When the card is rendered in English, Then each is a link marked as outside, under its own heading', () => {
  const card = String(
    profileCard(
      'kfly8',
      {
        ...profile,
        website: 'https://example.com/',
        links: ['https://bsky.app/profile/k', 'https://github.com/k'],
      },
      'en',
    ),
  )
  expect(card).toContain('Website')
  expect(card).toContain('Social')
  expect(card.match(/rel="nofollow noopener noreferrer ugc"/g)).toHaveLength(3)
  expect(card).toContain('>bsky.app/profile/k</a')
})
