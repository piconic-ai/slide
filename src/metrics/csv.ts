import type { Cell, MetricsTable, Row } from './table'

/**
 * One CSV field. A field that begins with a character a spreadsheet reads as
 * a formula (`=`, `+`, `-`, `@`, a tab or a return) gets a quote mark in
 * front, so that a hostile search word or host name is text when the file is
 * opened. A field with a comma, a quote or a line break is quoted.
 */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value
  return /[",\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

const number = (value: number, digits: number) =>
  String(Math.round(value * 10 ** digits) / 10 ** digits)

const valueOf = (cell: Cell, unit: Row['unit']) =>
  cell.value === null ? '' : number(cell.value, unit === 'minutes' ? 1 : 0)

/** A share as a percent with one decimal, or nothing. */
const shareOf = (cell: Cell) =>
  cell.share === null ? '' : number(cell.share * 100, 1)

/**
 * The table as CSV, with the same content as the page (F40-AC20): a line for
 * each row, the weeks across; a row that has a share is followed by a line of
 * the shares in percent. Lines end with CRLF. The header names the weeks by
 * their Monday as a date.
 */
export function csvOf(table: MetricsTable): string {
  const lines: string[][] = [
    ['区分', '項目', ...table.weeks.map((week) => week.start)],
  ]
  for (const group of table.groups)
    for (const row of group.rows) {
      lines.push([
        group.heading,
        row.label,
        ...row.cells.map((cell) => valueOf(cell, row.unit)),
      ])
      if (row.cells.some((cell) => cell.share !== null))
        lines.push([
          group.heading,
          `${row.label}(割合 %)`,
          ...row.cells.map(shareOf),
        ])
    }
  return `${lines.map((line) => line.map(csvField).join(',')).join('\r\n')}\r\n`
}
