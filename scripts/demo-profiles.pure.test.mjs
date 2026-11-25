import { expect, test } from 'vitest'
import { bioOf, linkOf as websiteOf } from '../src/profile/profile-lines'
import { DEMO_PROFILES, profileSql } from './demo-profiles.mjs'

test('Given the demo profiles, When they are read as the service reads a profile, Then every fixed value is one it would keep', () => {
  for (const profile of Object.values(DEMO_PROFILES)) {
    expect(websiteOf(profile.website)).toBe(profile.website)
    expect(bioOf(profile.bio)).toBe(profile.bio)
    expect(profile.name.length).toBeLessThanOrEqual(50)
  }
})

test('Given an id without a demo profile, When its statement is asked for, Then it is refused', () => {
  expect(() => profileSql('1')).toThrow('No demo profile')
})
