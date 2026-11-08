import { readdir, readFile } from 'node:fs/promises'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'

/** Applies checked-in D1 migrations in order within an optional name range. */
export async function applyMigrations(
  db: D1Database,
  { after = '', until = '\uffff' }: { after?: string; until?: string } = {},
) {
  const orm = drizzle(db)
  const names = (await readdir('migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort()
  for (const name of names) {
    if (name <= after || name > until) continue
    const migration = await readFile(`migrations/${name}`, 'utf8')
    const statements = migration
      .split(';')
      .filter((statement) => statement.replace(/--.*$/gm, '').trim())
      .map((statement) => orm.run(sql.raw(statement)))
    const [first, ...remaining] = statements
    if (first) await orm.batch([first, ...remaining])
  }
}
