import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from '../src/db/test-migrations'
import { readProfile } from '../src/profile/store'
import { DEMO_PROFILES, profileSql } from './demo-profiles.mjs'

const platform = await getPlatformProxy({ persist: false })
beforeAll(() => applyMigrations(platform.env.DB))
afterAll(() => platform.dispose())

test('Given the demo statements run on an empty database, When the profiles are read, Then both have name, place, site and bio', async () => {
  const db = drizzle(platform.env.DB)
  for (const id of Object.keys(DEMO_PROFILES))
    await db.run(sql.raw(profileSql(id)))
  const author = await readProfile(platform.env.DB, '722500')
  const reader = await readProfile(platform.env.DB, '900001')
  expect(author).toMatchObject({
    name: 'Kenta Demo',
    avatarUrl: '/avatars/722500?v=g',
    location: 'Tokyo, Japan',
    website: 'https://example.com/',
  })
  expect(author?.bio).toContain('Demo author')
  expect(reader).toMatchObject({
    avatarUrl: '/avatars/900001?v=g',
    name: 'Rina Reader',
  })
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
