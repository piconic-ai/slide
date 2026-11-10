/**
 * Adds header names to a Vary value, keeping the names already there.
 * Names compare case-insensitively; `*` already covers every name.
 */
export function withVary(vary: string | null, names: readonly string[]) {
  const current = (vary ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  if (current.includes('*')) return '*'
  const seen = new Set(current.map((name) => name.toLowerCase()))
  const added = names.filter((name) => !seen.has(name.toLowerCase()))
  return [...current, ...added].join(', ')
}
