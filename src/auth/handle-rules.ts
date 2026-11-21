import { handleSchema, type Handle } from '../share/handle'

/**
 * Words no one may take as a handle: the first segment of every route the
 * service answers, the words of the sign-in and settings pages, and names
 * that read as the operator's. `handle-rules.test.ts` checks the routes.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  // The first segment of routes (checked against the app's routes).
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
  // Words after a handle, so /@name/cited never reads as a person.
  'cited',
  'citing',
  'followers',
  'following',
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
