// What a connection may do. Pure.

/**
 * The words a connection's scope is made of (RFC 6749, 3.3). `slides:upload`
 * puts slides and articles up; `slides:export` reads them out again. A
 * connection made before `slides:export` existed holds only the first.
 */
export const SCOPES = ['slides:upload', 'slides:export'] as const
export type Scope = (typeof SCOPES)[number]

/** The scope every connection had before the export tools (docs/dev/f35-agent-export.md). */
export const UPLOAD_SCOPE: Scope = 'slides:upload'
export const EXPORT_SCOPE: Scope = 'slides:export'

/**
 * What allowing on the consent screen grants: everything the screen lists.
 * The request's own `scope` is not read, so one answer covers all of it and
 * the screen never says less than what was granted.
 */
export const GRANTED_SCOPES: readonly Scope[] = SCOPES

/** A list of scopes as the space-separated text OAuth and D1 carry. */
export const scopeText = (scopes: readonly Scope[]): string => scopes.join(' ')

/**
 * The scopes in stored text. A word this version does not know is dropped,
 * so a row written by a later version grants no more than is known here.
 */
export function parseScopes(text: string): readonly Scope[] {
  const words = new Set(text.split(' '))
  return SCOPES.filter((scope) => words.has(scope))
}

/** Whether the scopes allow reading slides and articles out. */
export const canExport = (scopes: readonly Scope[]): boolean =>
  scopes.includes(EXPORT_SCOPE)
