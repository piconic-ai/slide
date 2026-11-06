import { readdir, readFile } from 'node:fs/promises'

/** Applies checked-in D1 migrations in order within an optional name range. */
export async function applyMigrations(
  db: D1Database,
  { after = '', until = '\uffff' }: { after?: string; until?: string } = {},
) {
  const names = (await readdir('migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort()
  for (const name of names) {
    if (name <= after || name > until) continue
    const migration = await readFile(`migrations/${name}`, 'utf8')
    await db.batch(
      migration
        .split(';')
        .filter((statement) => statement.replace(/--.*$/gm, '').trim())
        .map((statement) => db.prepare(statement)),
    )
  }
}
