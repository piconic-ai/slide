import { expect, test } from 'vitest'
import { profileCard } from './pages'

const profile = {
  name: 'Kenta',
  avatarUrl: null,
  location: null,
  website: null,
  bio: null,
}

test('Given a profile without a picture, When the card is rendered, Then the first letter of the name stands in and no color block is used', () => {
  const card = String(profileCard('kfly8', profile, 'en'))
  expect(card).toContain('portrait-initial')
  expect(card).toContain('>K</span')
  expect(card).not.toContain('color-block')
  expect(card).not.toContain('<img')
})

test('Given a profile with a picture, When the card is rendered, Then the picture shows and no letter does', () => {
  const card = String(
    profileCard('kfly8', { ...profile, avatarUrl: '/faces/1' }, 'ja'),
  )
  expect(card).toContain('<img')
  expect(card).not.toContain('portrait-initial')
})
