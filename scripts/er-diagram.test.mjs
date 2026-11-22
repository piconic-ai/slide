import { describe, expect, it } from 'vitest'
import { compareDocument } from './er-check.mjs'
import { extractChecks } from './er-checks.mjs'
import {
  mermaidIdent,
  relationsOf,
  renderDiagram,
  renderDocument,
} from './er-diagram.mjs'
import { assignmentProblems } from './er-domains.mjs'

const col = (name, type = 'TEXT', extra = {}) => ({
  name,
  type,
  notNull: false,
  pkOrder: 0,
  ...extra,
})
const table = (name, columns, extra = {}) => ({
  name,
  columns,
  foreignKeys: [],
  uniques: [],
  checks: [],
  ...extra,
})

describe('renderDiagram', () => {
  it('Given no tables, then only the erDiagram header is drawn', () => {
    expect(renderDiagram([], [], { withColumns: true })).toBe('erDiagram')
  })

  it('Given a table with a key, a unique column and a check, then each shows its marker', () => {
    const users = table(
      'users',
      [
        col('id', 'INTEGER', { pkOrder: 1, notNull: true }),
        col('email'),
        col('role'),
      ],
      { uniques: [['email']], checks: ["role IN ('a', 'b')"] },
    )
    expect(renderDiagram([users], ['users'], { withColumns: true })).toBe(
      [
        'erDiagram',
        '    users {',
        '        INTEGER id PK',
        '        TEXT email UK',
        '        TEXT role "CHECK"',
        '    }',
      ].join('\n'),
    )
  })

  it('Given a composite primary key, then every key column is PK', () => {
    const pair = table('pair', [
      col('a', 'TEXT', { pkOrder: 1, notNull: true }),
      col('b', 'TEXT', { pkOrder: 2, notNull: true }),
    ])
    const text = renderDiagram([pair], ['pair'], { withColumns: true })
    expect(text).toContain('TEXT a PK')
    expect(text).toContain('TEXT b PK')
  })

  it('Given a composite UNIQUE, then both columns are UK and name the other', () => {
    const t = table('t', [col('a'), col('b')], { uniques: [['a', 'b']] })
    const text = renderDiagram([t], ['t'], { withColumns: true })
    expect(text).toContain('TEXT a UK "unique: a + b"')
    expect(text).toContain('TEXT b UK "unique: a + b"')
  })

  it('Given a self-referencing foreign key, then the relation joins the table to itself', () => {
    const tree = table(
      'tree',
      [col('id', 'TEXT', { pkOrder: 1 }), col('parent_id')],
      {
        foreignKeys: [
          { columns: ['parent_id'], refTable: 'tree', refColumns: ['id'] },
        ],
      },
    )
    const text = renderDiagram([tree], ['tree'], { withColumns: false })
    expect(text).toContain('tree |o--o{ tree : "parent_id"')
  })

  it('Given two foreign keys to one table, then each gets its own labelled line', () => {
    const decks = table('decks', [col('id', 'TEXT', { pkOrder: 1 })])
    const link = table(
      'link',
      [col('a', 'TEXT', { notNull: true }), col('b')],
      {
        foreignKeys: [
          { columns: ['a'], refTable: 'decks', refColumns: ['id'] },
          { columns: ['b'], refTable: 'decks', refColumns: ['id'] },
        ],
      },
    )
    expect(
      relationsOf([decks, link]).map((r) => [r.label, r.parentOptional]),
    ).toEqual([
      ['a', false],
      ['b', true],
    ])
  })

  it('Given a foreign key that is also unique, then the child end is one', () => {
    const parent = table('parent', [col('id', 'TEXT', { pkOrder: 1 })])
    const child = table(
      'child',
      [col('p', 'TEXT', { pkOrder: 1, notNull: true })],
      {
        foreignKeys: [
          { columns: ['p'], refTable: 'parent', refColumns: ['id'] },
        ],
      },
    )
    expect(
      renderDiagram([parent, child], ['parent', 'child'], {
        withColumns: false,
      }),
    ).toContain('parent ||--o| child : "p"')
  })

  it('Given a composite foreign key, then it is one relation labelled with both columns', () => {
    const child = table(
      'child',
      [
        col('x', 'TEXT', { notNull: true }),
        col('y', 'TEXT', { notNull: true }),
      ],
      {
        foreignKeys: [
          { columns: ['x', 'y'], refTable: 'parent', refColumns: ['x', 'y'] },
        ],
      },
    )
    expect(relationsOf([child])).toHaveLength(1)
    expect(relationsOf([child])[0].label).toBe('x, y')
  })

  it('Given a reference to a table outside the diagram, then it is drawn bare and its own relations are left out', () => {
    const outside = table('outside', [col('id', 'TEXT', { pkOrder: 1 })], {
      foreignKeys: [{ columns: ['id'], refTable: 'other', refColumns: ['id'] }],
    })
    const inside = table('inside', [col('o', 'TEXT', { notNull: true })], {
      foreignKeys: [
        { columns: ['o'], refTable: 'outside', refColumns: ['id'] },
      ],
    })
    const text = renderDiagram([outside, inside], ['inside'], {
      withColumns: true,
    })
    expect(text).toContain('\n    outside\n')
    expect(text).not.toContain('other')
  })

  it('Given names Mermaid cannot read, then they become identifiers and quotes in labels are softened', () => {
    expect(mermaidIdent('my-col.name')).toBe('my_col_name')
    expect(mermaidIdent('1st')).toBe('_1st')
    const odd = table(
      'odd table',
      [col('a "b"', 'VARCHAR(10)'), col('c', '')],
      {
        checks: ['"a ""b""" > 0'],
      },
    )
    const text = renderDiagram([odd], ['odd table'], { withColumns: true })
    expect(text).toContain('odd_table {')
    expect(text).toContain('VARCHAR_10_ a__b_')
    expect(text).toContain('ANY c')
  })
})

describe('renderDocument', () => {
  it('Given tables and domains, then the overview comes first and each domain follows', () => {
    const tables = [table('b', [col('id')]), table('a', [col('id')])]
    const text = renderDocument(tables, [
      { id: 'x', title: '見出し', summary: '説明', tables: ['a', 'b'] },
    ])
    expect(
      text.startsWith(
        '# データベースの ER 図\n\n生成物。手で編集しない。`pnpm db:er`',
      ),
    ).toBe(true)
    expect(text.indexOf('## 全体の関係')).toBeLessThan(
      text.indexOf('## 見出し'),
    )
    expect(text.endsWith('```\n')).toBe(true)
    expect(text.match(/```mermaid/g)).toHaveLength(2)
  })
})

describe('extractChecks', () => {
  it.each([
    ['', []],
    ['CREATE TABLE t (a TEXT)', []],
    ["a TEXT CHECK (a IN ('x', 'y'))", ["a IN ('x', 'y')"]],
    ["CHECK (a != ')') , CHECK(length(b) > 0)", ["a != ')'", 'length(b) > 0']],
    ['CHECK (a > (1 + 2))', ['a > (1 + 2)']],
    ['CHECK (a > 1', []],
  ])('Given %j, then the bodies are %j', (sql, expected) => {
    expect(extractChecks(sql)).toEqual(expected)
  })
})

describe('assignmentProblems', () => {
  const domains = [
    { id: 'one', title: '', summary: '', tables: ['a', 'b'] },
    { id: 'two', title: '', summary: '', tables: ['b', 'ghost'] },
  ]

  it('Given a table in no domain, in two, or missing, then each is named', () => {
    const problems = assignmentProblems(['a', 'b', 'c'], domains)
    expect(problems).toEqual([
      'two lists ghost, which no migration creates',
      'b is in several domains: one, two',
      'c is in no domain: add it to DOMAINS',
    ])
  })

  it('Given a clean split, then there are no problems', () => {
    expect(
      assignmentProblems(
        ['a'],
        [{ id: 'x', title: '', summary: '', tables: ['a'] }],
      ),
    ).toEqual([])
  })
})

describe('compareDocument', () => {
  it('Given equal text, then it is ok', () => {
    expect(compareDocument('x', 'x')).toEqual({ ok: true })
  })

  it('Given a stale file or none, then the message says to run pnpm db:er', () => {
    for (const committed of ['old', null]) {
      const result = compareDocument(committed, 'new')
      expect(result.ok).toBe(false)
      expect(result.message).toContain('Run `pnpm db:er`')
    }
  })
})
