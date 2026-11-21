import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from '../src/db/test-migrations'
import { bioOf, websiteOf } from '../src/profile/profile-lines'
import { readProfile } from '../src/profile/store'
import { DEMO_PROFILES, profileSql } from './demo-profiles.mjs'

const platform = await getPlatformProxy({ persist: false })
beforeAll(() => applyMigrations(platform.env.DB))
afterAll(() => platform.dispose())

test('Given the demo profiles, When they are read as the service reads a profile, Then every fixed value is one it would keep', () => {
  for (const profile of Object.values(DEMO_PROFILES)) {
    expect(websiteOf(profile.website)).toBe(profile.website)
    expect(bioOf(profile.bio)).toBe(profile.bio)
    expect(profile.name.length).toBeLessThanOrEqual(50)
  }
})

test('Given the demo statements run on an empty database, When the profiles are read, Then both have name, place, site and bio', async () => {
  const db = drizzle(platform.env.DB)
  for (const id of Object.keys(DEMO_PROFILES))
    await db.run(sql.raw(profileSql(id)))
  const author = await readProfile(platform.env.DB, '722500')
  const reader = await readProfile(platform.env.DB, '900001')
  expect(author).toMatchObject({
    name: 'Kenta Demo',
    avatarUrl: null,
    location: 'Tokyo, Japan',
    website: 'https://example.com/',
  })
  expect(author?.bio).toContain('Demo author')
  expect(reader).toMatchObject({ avatarUrl: null, name: 'Rina Reader' })
  expect(reader?.bio).toContain('Demo reader')
})

test('Given the demo statements run twice, When the profile is read, Then it is replaced, not duplicated', async () => {
  const db = drizzle(platform.env.DB)
  await db.run(sql.raw(profileSql('900001')))
  await db.run(sql.raw(profileSql('900001')))
  const rows = await db.all(
    sql`SELECT user_id FROM profiles WHERE user_id = '900001'`,
  )
  expect(rows).toHaveLength(1)
})

test('Given an id without a demo profile, When its statement is asked for, Then it is refused', () => {
  expect(() => profileSql('1')).toThrow('No demo profile')
})
