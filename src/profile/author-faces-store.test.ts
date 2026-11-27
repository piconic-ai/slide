import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { accounts, profilePictures, profiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { readAuthorFaces } from './author-faces-store'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await db.delete(profilePictures)
  await db.delete(profiles)
  await db.delete(accounts)
})
afterAll(() => platform.dispose())

const account = (n: number) => ({
  user_id: `u${n}`,
  handle: `h${n}`,
  created_at: 1,
})

test('Given an author with no profile row, When faces are read, Then Gravatar is on as it is for everyone at first', async () => {
  await db.insert(accounts).values(account(1))
  expect(await readAuthorFaces(database, ['h1'])).toEqual(
    new Map([['h1', '/avatars/u1?v=g']]),
  )
})

test('Given an uploaded picture and Gravatar on, When faces are read, Then the uploaded picture wins, versioned by its time', async () => {
  await db.insert(accounts).values(account(1))
  await db.insert(profiles).values({ user_id: 'u1', name: 'One' })
  await db.insert(profilePictures).values({ user_id: 'u1', uploaded_at: 1234 })
  expect(await readAuthorFaces(database, ['h1'])).toEqual(
    new Map([['h1', '/avatars/u1?v=u1234']]),
  )
})

test('Given Gravatar turned off and no picture, When faces are read, Then the address names no picture', async () => {
  await db.insert(accounts).values(account(1))
  await db
    .insert(profiles)
    .values({ user_id: 'u1', name: 'One', use_gravatar: 0 })
  expect(await readAuthorFaces(database, ['h1'])).toEqual(
    new Map([['h1', '/avatars/u1?v=n']]),
  )
})

test('Given an unknown handle, a duplicate and no handles at all, When faces are read, Then only the known handle has a face, once, and nothing is asked for none', async () => {
  await db.insert(accounts).values(account(1))
  expect(await readAuthorFaces(database, ['nobody', 'h1', 'h1'])).toEqual(
    new Map([['h1', '/avatars/u1?v=g']]),
  )
  expect(await readAuthorFaces(database, [])).toEqual(new Map())
})

test('Given more authors than one query names, When faces are read, Then every author has their own face', async () => {
  const numbers = Array.from({ length: 120 }, (_, i) => i + 1)
  // D1 binds at most 100 values to a statement: seed one row at a time.
  const [first, ...rest] = numbers.map((n) =>
    db.insert(accounts).values(account(n)),
  )
  await db.batch([first!, ...rest])
  // One of them, past the first chunk, has an uploaded picture.
  await db.insert(profilePictures).values({ user_id: 'u110', uploaded_at: 7 })
  const faces = await readAuthorFaces(
    database,
    numbers.map((n) => `h${n}`),
  )
  expect(faces.size).toBe(120)
  expect(faces.get('h1')).toBe('/avatars/u1?v=g')
  expect(faces.get('h110')).toBe('/avatars/u110?v=u7')
})
