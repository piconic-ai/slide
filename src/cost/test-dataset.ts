import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
// @ts-expect-error -- a plain ES module without type declarations
import { datasetStatements } from '../../scripts/load/dataset-sql.mjs'

export type DatasetSize = Parameters<typeof datasetStatements>[0]

// @ts-expect-error -- a plain ES module without type declarations
export { LARGE_DATASET } from '../../scripts/load/dataset-sql.mjs'

/**
 * Fills the database with people, public slides, their files, follows,
 * citations and communities, a handful of statements however large the data
 * is (scripts/load/dataset-sql.mjs). Run after `resetTables`; the person who
 * reads is made apart.
 */
export async function seedDataset(database: D1Database, size: DatasetSize) {
  const orm = drizzle(database)
  for (const statement of datasetStatements(size) as string[])
    await orm.run(sql.raw(statement))
}
