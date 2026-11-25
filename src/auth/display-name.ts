export const DISPLAY_NAME_MAX = 50

export type DisplayNameCheck =
  | Readonly<{ kind: 'valid'; name: string }>
  | Readonly<{ kind: 'refused'; reason: 'empty' | 'too_long' }>

/**
 * What a typed display name may be: at least one visible character after the
 * surrounding white space (full-width space included) is taken off, and at
 * most 50 characters, counted as code points so an emoji is one.
 */
export function checkDisplayName(input: unknown): DisplayNameCheck {
  const name = typeof input === 'string' ? input.trim() : ''
  if (name === '') return { kind: 'refused', reason: 'empty' }
  if (Array.from(name).length > DISPLAY_NAME_MAX)
    return { kind: 'refused', reason: 'too_long' }
  return { kind: 'valid', name }
}
