// Pure: pulls the bodies of CHECK constraints out of a CREATE TABLE statement.

/**
 * Returns the text inside every `CHECK (...)` of `sql`, in order. Parentheses
 * inside single-quoted strings do not count, and an unclosed CHECK is dropped.
 * @param {string} sql
 * @returns {string[]}
 */
export function extractChecks(sql) {
  const checks = []
  const keyword = /\bCHECK\s*\(/gi
  let found
  while ((found = keyword.exec(sql)) !== null) {
    const start = keyword.lastIndex
    const end = closingParen(sql, start)
    if (end === -1) break
    checks.push(sql.slice(start, end).trim())
    keyword.lastIndex = end
  }
  return checks
}

/** The index of the `)` that closes the one opened just before `from`. */
function closingParen(sql, from) {
  let depth = 1
  let quoted = false
  for (let i = from; i < sql.length; i++) {
    const char = sql[i]
    if (char === "'") quoted = !quoted
    else if (quoted) continue
    else if (char === '(') depth++
    else if (char === ')' && --depth === 0) return i
  }
  return -1
}
