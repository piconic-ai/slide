import { handleSchema, type Handle } from '../share/handle'

/**
 * The first segment of every fixed route the app answers, and the words of
 * the sign-in and settings pages. `handle-rules.test.ts` checks that this is
 * exactly the app's routes: a route added without its word, or a word with no
 * route, fails there.
 */
export const ROUTE_HANDLES: readonly string[] = [
  'account',
  'api',
  'auth',
  'avatars',
  'contact',
  'covers',
  'embed',
  'events',
  'follows',
  'help',
  'login',
  'mcp',
  'mutes',
  'notifications',
  'oauth',
  'oembed',
  'operator',
  'privacy',
  'reports',
  'settings',
  'slides',
  'start',
  'terms',
  'uploads',
  'welcome',
]

/**
 * Words after a handle, so /@name/cited never reads as a person.
 * `handle-rules.test.ts` checks them against the share path's lists.
 */
export const AFTER_HANDLE_WORDS: readonly string[] = [
  'cited',
  'citing',
  'followers',
  'following',
]

/** Words no one may take as a handle. */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  ...ROUTE_HANDLES,
  ...AFTER_HANDLE_WORDS,
  // Names that pass for the operator or for a page of the service.
  'admin',
  'administrator',
  'abuse',
  'official',
  'root',
  'security',
  'slide',
  'staff',
  'support',
  'me',
  'system',
])

export type HandleRefusal =
  | 'empty'
  | 'too_long'
  | 'invalid_characters'
  | 'leading_hyphen'
  | 'reserved'

export type HandleCheck =
  | Readonly<{ kind: 'valid'; handle: Handle }>
  | Readonly<{ kind: 'refused'; reason: HandleRefusal }>

/**
 * What a typed handle may be: 1 to 39 characters, a to z, 0 to 9 and `-`,
 * not starting with `-`, and not reserved. The text is taken as typed,
 * except that upper case is not accepted (the person is told, not corrected).
 */
export function checkHandle(input: string): HandleCheck {
  if (input.length === 0) return { kind: 'refused', reason: 'empty' }
  if (input.length > 39) return { kind: 'refused', reason: 'too_long' }
  if (/[^a-z0-9-]/.test(input))
    return { kind: 'refused', reason: 'invalid_characters' }
  if (input.startsWith('-'))
    return { kind: 'refused', reason: 'leading_hyphen' }
  if (RESERVED_HANDLES.has(input))
    return { kind: 'refused', reason: 'reserved' }
  const parsed = handleSchema.safeParse(input)
  return parsed.success
    ? { kind: 'valid', handle: parsed.data }
    : { kind: 'refused', reason: 'invalid_characters' }
}
