// The rows of a database that holds a lot: people, public slides, their files,
// follows, citations and communities, as SQL statements that each insert a
// whole series with `INSERT ... SELECT`. Pure: it returns text. The cost tests
// (src/cost/test-dataset.ts) run it against the local D1, and
// make-dataset-sql.mjs prints it for a D1 the operator fills by hand, such as
// the environment a load test runs against (docs/dev/scale-cost.md).

/**
 * How much a seeded database holds.
 *
 * @typedef {{
 *   people: number,
 *   slides: number,
 *   filesPerSlide: number,
 *   followsPerPerson: number,
 *   citations: number,
 *   communities: number,
 *   communityFollowers: number,
 * }} DatasetSize
 */

/**
 * The size the scale and cost design measures at (D-144). `filesPerSlide` are
 * the files recorded under each slide's public version, `followsPerPerson`
 * the people after each person that they follow, and `communityFollowers` the
 * first people who follow each community.
 *
 * @type {DatasetSize}
 */
export const LARGE_DATASET = {
  people: 1_000,
  slides: 10_000,
  filesPerSlide: 3,
  followsPerPerson: 20,
  citations: 5_000,
  communities: 50,
  communityFollowers: 100,
}

/** A series 1..count to insert from, as one statement. */
const series = (count) =>
  `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${count})`

/**
 * The statements that fill an empty database, in the order to run them.
 * People are `u<i>` with the handle `p<i>`; slides are `d<i>` named `s<i>`,
 * owned round-robin, with the public version `dep<i>`, ready at `i * 60`, so a
 * larger number is newer. A person's handle row follows from the account (a
 * trigger of migration 0053).
 *
 * @param {DatasetSize} size
 * @returns {string[]}
 */
export function datasetStatements(size) {
  const { people, slides } = size
  return [
    `${series(people)} INSERT INTO accounts (user_id, handle, created_at)
    SELECT 'u' || i, 'p' || i, 1 FROM n`,
    `${series(people)} INSERT INTO profiles (user_id, name)
    SELECT 'u' || i, 'Person ' || i FROM n`,
    `${series(slides)} INSERT INTO decks (id, slug, owner_user_id, created_at, first_published_at)
    SELECT 'd' || i, 's' || i, 'u' || (1 + (i % ${people})), 1, i * 60 FROM n`,
    `${series(slides)} INSERT INTO deployments
      (id, idempotency_key, inventory_digest, state, total_bytes, token_hash,
       created_at, expires_at, credential_expires_at, ready_at, deck_id,
       title, source)
    SELECT 'dep' || i, 'key' || i, 'digest', 'ready', 1000, 'hash', 1, 2, 2,
      i * 60, 'd' || i, 'Slide ' || i, 'browser' FROM n`,
    `UPDATE decks SET public_deployment_id = 'dep' || substr(id, 2)`,
    `${series(slides * size.filesPerSlide)} INSERT INTO upload_files
      (deployment_id, id, path, size, sha256, media_type, object_key)
    SELECT 'dep' || (1 + (i - 1) / ${size.filesPerSlide}),
      CAST(i AS TEXT), 'f' || i || '.js', 100, 'sha' || i,
      'text/javascript', 'k/' || i FROM n`,
    `${series(people * size.followsPerPerson)} INSERT INTO follows
      (follower_user_id, followee_user_id, created_at)
    SELECT 'u' || (1 + ((i - 1) / ${size.followsPerPerson})),
      'u' || (1 + (((i - 1) / ${size.followsPerPerson}) + 1 + ((i - 1) % ${size.followsPerPerson})) % ${people}),
      i FROM n`,
    `${series(size.citations)} INSERT INTO citations
      (deployment_id, target_handle, target_slug, target_page)
    SELECT 'dep' || i, 'p' || (1 + ((i + 1) % ${people})),
      's' || (1 + ((i * 7) % ${slides})), 0 FROM n`,
    `${series(size.communities)} INSERT INTO communities (id, name, color, created_at)
    SELECT i, 'Community ' || i, 'red', 1 FROM n`,
    `${series(size.communities)} INSERT INTO handles (handle, owner_kind, owner_id, created_at)
    SELECT 'c' || i, 'community', CAST(i AS TEXT), 1 FROM n`,
    `${series(size.communities * size.communityFollowers)} INSERT INTO community_follows
      (user_id, community_id, created_at)
    SELECT 'u' || (1 + ((i - 1) % ${size.communityFollowers})),
      1 + ((i - 1) / ${size.communityFollowers}), i FROM n`,
  ]
}
