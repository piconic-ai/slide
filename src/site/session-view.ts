import type { Owner } from '../auth/owner-session'

/** What a page may know about its visitor to draw the header's menu. */
export type SessionView =
  | Readonly<{ signedIn: false }>
  | Readonly<{ signedIn: true; login: string; handle: string | null }>

export const sessionView = (
  owner: Owner | null,
  handle: string | null,
): SessionView =>
  owner ? { signedIn: true, login: owner.login, handle } : { signedIn: false }
