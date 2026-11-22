import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareDocument } from './er-check.mjs'
import { DOMAINS } from './er-domains.mjs'
import { DOCUMENT_PATH, generateDocument } from './er-generate.mjs'
import { applyMigrations, readTables } from './er-schema.mjs'

function migrationsDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'er-'))
  for (const [name, sql] of Object.entries(files))
    writeFileSync(join(dir, name), sql)
  return dir
}

describe('docs/dev/er-diagram.md', () => {
  it('Given the migrations, when the document is generated, then it equals the committed file (run `pnpm db:er` if not)', () => {
    const committed = readFileSync(DOCUMENT_PATH, 'utf8')
    const result = compareDocument(committed, generateDocument())
    expect(result.ok ? 'ok' : result.message).toBe('ok')
  })

  it('Given every table the migrations create, then each is in exactly one domain', () => {
    const db = applyMigrations('migrations')
    const names = readTables(db).map((table) => table.name)
    db.close()
    const assigned = DOMAINS.flatMap((domain) => domain.tables)
    expect([...assigned].sort()).toEqual([...names].sort())
  })
})

describe('generateDocument', () => {
  it('Given a migration that adds a table in no domain, then generation fails naming it', () => {
    const dir = migrationsDir({
      '0001.sql': 'CREATE TABLE brand_new (id TEXT);',
    })
    expect(() => generateDocument(dir)).toThrow(/brand_new is in no domain/)
  })

  it('Given a migration with a syntax error, then the error names the file', () => {
    const dir = migrationsDir({ '0001.sql': 'CREATE TABLE (' })
    expect(() => applyMigrations(dir)).toThrow(/Migration 0001\.sql failed/)
  })
})

describe('readTables', () => {
  it('Given migrations applied in name order, then keys, foreign keys, uniques and checks are read', () => {
    const dir = migrationsDir({
      '0002.sql':
        'ALTER TABLE child ADD COLUMN note TEXT CHECK (length(note) < 5);',
      '0001.sql': `
        CREATE TABLE parent (a TEXT, b TEXT, PRIMARY KEY (a, b));
        CREATE TABLE child (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pa TEXT NOT NULL, pb TEXT NOT NULL,
          code TEXT UNIQUE,
          up TEXT, UNIQUE (pa, pb),
          FOREIGN KEY (pa, pb) REFERENCES parent
        );
        CREATE UNIQUE INDEX partial ON child (up) WHERE up IS NOT NULL;`,
    })
    const db = applyMigrations(dir)
    const [child, parent] = readTables(db)
    db.close()
    expect(parent.columns.map((c) => c.pkOrder)).toEqual([1, 2])
    expect(child.name).toBe('child')
    expect(child.foreignKeys).toEqual([
      { columns: ['pa', 'pb'], refTable: 'parent', refColumns: ['a', 'b'] },
    ])
    expect(child.uniques).toEqual(
      expect.arrayContaining([['code'], ['pa', 'pb']]),
    )
    expect(child.uniques).toHaveLength(2)
    expect(child.checks).toEqual(['length(note) < 5'])
    // sqlite_sequence is SQLite's own and is not a table of ours.
    expect([child.name, parent.name]).not.toContain('sqlite_sequence')
  })
})
