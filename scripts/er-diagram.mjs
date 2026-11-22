// Pure: tables read from SQLite -> Mermaid erDiagram text and the document.
// No file system, no database; er-schema.mjs reads, db-er.mjs writes.

/**
 * @typedef {{ name: string, type: string, notNull: boolean, pkOrder: number }} Column
 * pkOrder is 0 outside the primary key, else the 1-based position in it.
 * @typedef {{ columns: string[], refTable: string, refColumns: string[] }} ForeignKey
 * @typedef {{
 *   name: string,
 *   columns: Column[],
 *   foreignKeys: ForeignKey[],
 *   uniques: string[][],
 *   checks: string[],
 * }} Table
 * @typedef {{ parent: string, child: string, label: string, parentOptional: boolean, childUnique: boolean }} Relation
 */

/** An identifier Mermaid accepts: anything else becomes `_`. */
export function mermaidIdent(text) {
  const safe = text.replace(/[^A-Za-z0-9_]/g, '_')
  return /^[A-Za-z_]/.test(safe) ? safe : `_${safe}`
}

/** A quoted Mermaid string: a double quote would end it, so it turns single. */
function quoted(text) {
  return `"${text.replace(/["\r\n]+/g, "'")}"`
}

const sameSet = (a, b) =>
  a.length === b.length &&
  [...a].sort().every((name, i) => name === [...b].sort()[i])

/** Column names of the primary key, in key order. */
function primaryKey(table) {
  return table.columns
    .filter((column) => column.pkOrder > 0)
    .sort((a, b) => a.pkOrder - b.pkOrder)
    .map((column) => column.name)
}

/** True when the columns hold at most one row per value: the key or a UNIQUE. */
function isUnique(table, columns) {
  return (
    sameSet(columns, primaryKey(table)) ||
    table.uniques.some((unique) => sameSet(columns, unique))
  )
}

/**
 * One relation per declared foreign key. The parent end is optional when a
 * referencing column may be NULL; the child end is "one" when the
 * referencing columns are unique.
 * @param {Table[]} tables
 * @returns {Relation[]}
 */
export function relationsOf(tables) {
  return tables.flatMap((table) =>
    table.foreignKeys.map((foreignKey) => ({
      parent: foreignKey.refTable,
      child: table.name,
      label: foreignKey.columns.join(', '),
      parentOptional: foreignKey.columns.some(
        (name) => !table.columns.find((c) => c.name === name)?.notNull,
      ),
      childUnique: isUnique(table, foreignKey.columns),
    })),
  )
}

function renderRelation({ parent, child, label, parentOptional, childUnique }) {
  const left = parentOptional ? '|o' : '||'
  const right = childUnique ? 'o|' : 'o{'
  return `    ${mermaidIdent(parent)} ${left}--${right} ${mermaidIdent(child)} : ${quoted(label)}`
}

function renderAttribute(table, column) {
  const keys = []
  if (column.pkOrder > 0) keys.push('PK')
  if (table.foreignKeys.some((fk) => fk.columns.includes(column.name)))
    keys.push('FK')
  const unique = table.uniques.filter((u) => u.includes(column.name))
  if (unique.length > 0) keys.push('UK')
  const notes = unique
    .filter((u) => u.length > 1)
    .map((u) => `unique: ${u.join(' + ')}`)
  const escaped = column.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const word = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`)
  if (table.checks.some((check) => word.test(check))) notes.push('CHECK')
  const type = mermaidIdent(column.type || 'ANY')
  const parts = [`        ${type} ${mermaidIdent(column.name)}`]
  if (keys.length > 0) parts.push(keys.join(', '))
  if (notes.length > 0) parts.push(quoted(notes.join('; ')))
  return parts.join(' ')
}

function renderEntity(table) {
  const name = mermaidIdent(table.name)
  if (table.columns.length === 0) return [`    ${name}`]
  return [
    `    ${name} {`,
    ...table.columns.map((column) => renderAttribute(table, column)),
    '    }',
  ]
}

/**
 * One diagram. `names` picks the tables drawn in full (with columns when
 * `withColumns`); a table they reference outside `names` is drawn bare, and
 * relations into `names` from outside are left to the other diagram.
 * @param {Table[]} tables every table, which relations are read from
 * @param {string[]} names
 * @param {{ withColumns: boolean }} options
 */
export function renderDiagram(tables, names, { withColumns }) {
  const inside = new Set(names)
  const own = tables.filter((table) => inside.has(table.name))
  const relations = relationsOf(own)
  const bare = [...new Set(relations.map((r) => r.parent))]
    .filter((name) => !inside.has(name))
    .sort()
  const lines = [
    'erDiagram',
    ...own.flatMap((table) =>
      withColumns ? renderEntity(table) : [`    ${mermaidIdent(table.name)}`],
    ),
    ...bare.map((name) => `    ${mermaidIdent(name)}`),
    ...relations.map(renderRelation),
  ]
  return lines.join('\n')
}

const fence = (diagram) => ['```mermaid', diagram, '```'].join('\n')

/**
 * The whole document: an overview of every relation without columns, then
 * one diagram with columns per domain.
 * @param {Table[]} tables
 * @param {{ id: string, title: string, summary: string, tables: string[] }[]} domains
 */
export function renderDocument(tables, domains) {
  const sorted = [...tables].sort((a, b) => a.name.localeCompare(b.name))
  const all = sorted.map((table) => table.name)
  const sections = domains.map((domain) =>
    [
      `## ${domain.title}`,
      '',
      domain.summary,
      '',
      `表: ${domain.tables.map((name) => `\`${name}\``).join('、')}`,
      '',
      fence(renderDiagram(sorted, domain.tables, { withColumns: true })),
    ].join('\n'),
  )
  const lines = [
    '# データベースの ER 図',
    '',
    '生成物。手で編集しない。`pnpm db:er` で生成し直す。',
    '',
    '`migrations/` を空の SQLite に順に適用した結果から作る。本番の D1 に適用されるものが正本で、`src/db/schema.ts` は読まない。外部キーを宣言している参照だけを線で結ぶ。宣言のない参照(たとえば `owner_user_id`)は、列として図に出るだけで、線にはならない。',
    '',
    '## 読み方',
    '',
    '- 列の `PK` は主キー、`FK` は外部キー、`UK` は UNIQUE。複数の列で一意になるものは、備考に `unique: a + b` と出る。`CHECK` は、その列を CHECK 制約が参照している。',
    '- 線の `||` は必ず 1、`|o` は 0 または 1(参照する列が NULL を許す)、`o{` は 0 以上、`o|` は 0 または 1(参照する列が一意)。線の名前は、参照する列。',
    '- 別の図の表を参照するときは、その表を列なしで描く。部分的な UNIQUE(`WHERE` つきの索引)は一意として数えない。',
    '',
    '## 全体の関係',
    '',
    '全ての表と、宣言した外部キーだけ。列は各ドメインの図にある。',
    '',
    fence(renderDiagram(sorted, all, { withColumns: false })),
    '',
    ...sections.flatMap((section) => [section, '']),
  ]
  return lines.join('\n').trimEnd() + '\n'
}
