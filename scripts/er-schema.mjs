// Store: builds an in-memory SQLite from migrations/ and reads its schema as
// plain data. Everything that decides what to draw is in er-diagram.mjs.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { extractChecks } from './er-checks.mjs'

/** Applies every `*.sql` in `dir`, in name order, to a new in-memory SQLite. */
export function applyMigrations(dir) {
  const db = new DatabaseSync(':memory:')
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  for (const name of names) {
    try {
      db.exec(readFileSync(join(dir, name), 'utf8'))
    } catch (error) {
      throw new Error(`Migration ${name} failed: ${error.message}`, {
        cause: error,
      })
    }
  }
  return db
}

const quoteIdent = (name) => `"${name.replaceAll('"', '""')}"`

/** The tables of `db` as the plain data er-diagram.mjs draws. */
export function readTables(db) {
  const rows = db
    .prepare(
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
         AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'
       ORDER BY name`,
    )
    .all()
  const tables = rows.map(({ name, sql }) => ({
    name,
    columns: readColumns(db, name),
    foreignKeys: [],
    uniques: readUniques(db, name),
    checks: extractChecks(sql ?? ''),
  }))
  const byName = new Map(tables.map((table) => [table.name, table]))
  for (const table of tables)
    table.foreignKeys = readForeignKeys(db, table.name, byName)
  return tables
}

function readColumns(db, table) {
  return db
    .prepare(`PRAGMA table_info(${quoteIdent(table)})`)
    .all()
    .map((row) => ({
      name: row.name,
      type: row.type,
      notNull: row.notnull === 1 || row.pk > 0,
      pkOrder: row.pk,
    }))
}

/** Full (not partial) UNIQUE constraints and unique indexes, apart from the key. */
function readUniques(db, table) {
  return db
    .prepare(`PRAGMA index_list(${quoteIdent(table)})`)
    .all()
    .filter(
      (row) => row.unique === 1 && row.partial === 0 && row.origin !== 'pk',
    )
    .map((row) =>
      db
        .prepare(`PRAGMA index_info(${quoteIdent(row.name)})`)
        .all()
        .sort((a, b) => a.seqno - b.seqno)
        .map((column) => column.name),
    )
    .filter((columns) => columns.every((name) => name !== null))
}

/** Foreign keys grouped by id, so a composite key is one entry. */
function readForeignKeys(db, table, byName) {
  const groups = new Map()
  const rows = db
    .prepare(`PRAGMA foreign_key_list(${quoteIdent(table)})`)
    .all()
    .sort((a, b) => a.id - b.id || a.seq - b.seq)
  for (const row of rows) {
    const group = groups.get(row.id) ?? {
      columns: [],
      refTable: row.table,
      refColumns: [],
    }
    group.columns.push(row.from)
    group.refColumns.push(row.to)
    groups.set(row.id, group)
  }
  return [...groups.values()].map((group) => ({
    ...group,
    // `REFERENCES t` without columns points at t's primary key.
    refColumns: group.refColumns.every((name) => name !== null)
      ? group.refColumns
      : (byName
          .get(group.refTable)
          ?.columns.filter((column) => column.pkOrder > 0)
          .sort((a, b) => a.pkOrder - b.pkOrder)
          .map((column) => column.name) ?? []),
  }))
}
