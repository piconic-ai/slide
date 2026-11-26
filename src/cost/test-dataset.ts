import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'

/** How much a seeded database holds. */
export type DatasetSize = Readonly<{
  people: number
  slides: number
  /** Files recorded under each slide's public version. */
  filesPerSlide: number
  /** Each person follows this many of the people after them. */
  followsPerPerson: number
  citations: number
  communities: number
  /** Each community is followed by this many of the first people. */
  communityFollowers: number
}>

/** The size the scale and cost design measures at (D-144). */
export const LARGE_DATASET: DatasetSize = {
  people: 1_000,
  slides: 10_000,
  filesPerSlide: 3,
  followsPerPerson: 20,
  citations: 5_000,
  communities: 50,
  communityFollowers: 100,
}

/** A series 1..count to insert from, as one statement. */
const series = (count: number) =>
  `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${count})`

/**
 * Fills the database with people, public slides, their files, follows,
 * citations and communities by `INSERT ... SELECT` over a series, a handful
 * of statements however large the data is. People are `u<i>` with the
 * handle `p<i>`; slides are `d<i>` named `s<i>`, owned round-robin, with the
 * public version `dep<i>`, ready at `i * 60`, so a larger number is newer.
 * A person's handle row follows from the account (a trigger of migration
 * 0053). Run after `resetTables`; the person who reads is made apart.
 */
export async function seedDataset(database: D1Database, size: DatasetSize) {
  const orm = drizzle(database)
  const run = (statement: string) => orm.run(sql.raw(statement))
  const { people, slides } = size
  await run(`${series(people)} INSERT INTO accounts (user_id, handle, created_at)
    SELECT 'u' || i, 'p' || i, 1 FROM n`)
  await run(`${series(people)} INSERT INTO profiles (user_id, name)
    SELECT 'u' || i, 'Person ' || i FROM n`)
  await run(`${series(slides)} INSERT INTO decks (id, slug, owner_user_id, created_at, first_published_at)
    SELECT 'd' || i, 's' || i, 'u' || (1 + (i % ${people})), 1, i * 60 FROM n`)
  await run(`${series(slides)} INSERT INTO deployments
      (id, idempotency_key, inventory_digest, state, total_bytes, token_hash,
       created_at, expires_at, credential_expires_at, ready_at, deck_id,
       title, source)
    SELECT 'dep' || i, 'key' || i, 'digest', 'ready', 1000, 'hash', 1, 2, 2,
      i * 60, 'd' || i, 'Slide ' || i, 'browser' FROM n`)
  await run(`UPDATE decks SET public_deployment_id = 'dep' || substr(id, 2)`)
  await run(`${series(slides * size.filesPerSlide)} INSERT INTO upload_files
      (deployment_id, id, path, size, sha256, media_type, object_key)
    SELECT 'dep' || (1 + (i - 1) / ${size.filesPerSlide}),
      CAST(i AS TEXT), 'f' || i || '.js', 100, 'sha' || i,
      'text/javascript', 'k/' || i FROM n`)
  await run(`${series(people * size.followsPerPerson)} INSERT INTO follows
      (follower_user_id, followee_user_id, created_at)
    SELECT 'u' || (1 + ((i - 1) / ${size.followsPerPerson})),
      'u' || (1 + (((i - 1) / ${size.followsPerPerson}) + 1 + ((i - 1) % ${size.followsPerPerson})) % ${people}),
      i FROM n`)
  await run(`${series(size.citations)} INSERT INTO citations
      (deployment_id, target_handle, target_slug, target_page)
    SELECT 'dep' || i, 'p' || (1 + ((i + 1) % ${people})),
      's' || (1 + ((i * 7) % ${slides})), 0 FROM n`)
  await run(`${series(size.communities)} INSERT INTO communities (id, name, color, created_at)
    SELECT i, 'Community ' || i, 'red', 1 FROM n`)
  await run(`${series(size.communities)} INSERT INTO handles (handle, owner_kind, owner_id, created_at)
    SELECT 'c' || i, 'community', CAST(i AS TEXT), 1 FROM n`)
  await run(`${series(size.communities * size.communityFollowers)} INSERT INTO community_follows
      (user_id, community_id, created_at)
    SELECT 'u' || (1 + ((i - 1) % ${size.communityFollowers})),
      1 + ((i - 1) / ${size.communityFollowers}), i FROM n`)
}
