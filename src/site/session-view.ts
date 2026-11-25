import type { Owner } from '../auth/owner-session'

/** What a page may know about its visitor to draw the header's menu. */
export type SessionView =
  | Readonly<{ signedIn: false }>
  | Readonly<{
      signedIn: true
      login: string
      handle: string | null
      /** Their picture, a path on the service, for the header's icon. */
      avatarUrl: string | null
      /** How many notifications wait unread, for the bell. */
      unread: number
    }>

export const sessionView = (
  owner: Owner | null,
  handle: string | null,
  avatarUrl: string | null,
  unread = 0,
): SessionView =>
  owner
    ? {
        signedIn: true,
        login: owner.login,
        handle,
        avatarUrl,
        unread,
      }
    : { signedIn: false }
