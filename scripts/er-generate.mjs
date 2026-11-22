// Store: migrations/ -> the text of docs/dev/er-diagram.md.
import { assignmentProblems, DOMAINS } from './er-domains.mjs'
import { renderDocument } from './er-diagram.mjs'
import { applyMigrations, readTables } from './er-schema.mjs'

export const MIGRATIONS_DIR = 'migrations'
export const DOCUMENT_PATH = 'docs/dev/er-diagram.md'

/** Renders the document for the migrations in `dir`; throws on a table in no domain. */
export function generateDocument(dir = MIGRATIONS_DIR) {
  const db = applyMigrations(dir)
  try {
    const tables = readTables(db)
    const problems = assignmentProblems(
      tables.map((table) => table.name),
      DOMAINS,
    )
    if (problems.length > 0)
      throw new Error(`scripts/er-domains.mjs: ${problems.join('; ')}`)
    return renderDocument(tables, DOMAINS)
  } finally {
    db.close()
  }
}
