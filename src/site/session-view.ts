import type { Owner } from '../auth/owner-session'
import { avatarAtSize } from '../profile/github-profile'

// The icon is 32px wide; twice that keeps it sharp on dense screens.
const HEADER_ICON_PIXELS = 64

/** What a page may know about its visitor to draw the header's menu. */
export type SessionView =
  | Readonly<{ signedIn: false }>
  | Readonly<{
      signedIn: true
      login: string
      handle: string | null
      /** Their picture on GitHub, sized for the header's icon. */
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
        avatarUrl: avatarUrl && avatarAtSize(avatarUrl, HEADER_ICON_PIXELS),
        unread,
      }
    : { signedIn: false }
