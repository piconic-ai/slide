import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from '../src/db/test-migrations'
import { avatarUrlOf, bioOf, websiteOf } from '../src/profile/github-profile'
import { readProfile } from '../src/profile/store'
import { DEMO_PROFILES, profileSql } from './demo-profiles.mjs'

const platform = await getPlatformProxy({ persist: false })
beforeAll(() => applyMigrations(platform.env.DB))
afterAll(() => platform.dispose())

test('F21-AC35: Given the demo profiles, When they are read as GitHub profiles, Then every fixed value is one the service would keep', () => {
  for (const profile of Object.values(DEMO_PROFILES)) {
    expect(profile.avatarUrl === null || avatarUrlOf(profile.avatarUrl)).toBe(
      profile.avatarUrl === null ? true : profile.avatarUrl,
    )
    expect(websiteOf(profile.website)).toBe(profile.website)
    expect(bioOf(profile.bio)).toBe(profile.bio)
  }
})

test('F21-AC34, F21-AC37: Given the demo statements run on an empty database, When the profiles are read, Then the first has a picture and the second falls back to an initial, and both have name, place, site and bio', async () => {
  const db = drizzle(platform.env.DB)
  for (const id of Object.keys(DEMO_PROFILES))
    await db.run(sql.raw(profileSql(id, 1700000000)))
  const author = await readProfile(platform.env.DB, '722500')
  const reader = await readProfile(platform.env.DB, '900001')
  expect(author).toMatchObject({
    login: 'kfly8',
    name: 'Kenta Demo',
    avatarUrl: 'https://avatars.githubusercontent.com/u/722500?v=4',
    location: 'Tokyo, Japan',
    website: 'https://example.com/',
  })
  expect(author?.bio).toContain('Demo author')
  expect(reader).toMatchObject({ avatarUrl: null, name: 'Rina Reader' })
  expect(reader?.bio).toContain('Demo reader')
})

test('F21-AC35: Given the demo statements run twice, When the profile is read, Then it is replaced, not duplicated', async () => {
  const db = drizzle(platform.env.DB)
  await db.run(sql.raw(profileSql('900001', 1)))
  await db.run(sql.raw(profileSql('900001', 2)))
  expect((await readProfile(platform.env.DB, '900001'))?.syncedAt).toBe(2)
})

test('Given an id without a demo profile, When its statement is asked for, Then it is refused', () => {
  expect(() => profileSql('1', 1)).toThrow('No demo profile')
})
