import type { Owner } from '../auth/owner-session'

/** What a page may know about its visitor to draw the header's link. */
export type SessionView =
  | Readonly<{ signedIn: false }>
  | Readonly<{ signedIn: true; login: string }>

export const sessionView = (owner: Owner | null): SessionView =>
  owner ? { signedIn: true, login: owner.login } : { signedIn: false }
