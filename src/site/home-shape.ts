/**
 * How many slides of the people the visitor follows the "following" tab
 * shows first: two rows of four at 1280px (F03-AC161). The tab holds room
 * for this many from the start, so what comes changes nothing about the
 * page's height.
 */
export const HOME_FOLLOWING_SHOWN = 8

/** The tabs of the top page, in their order (F44-AC1). */
export const HOME_TABS = ['all', 'following'] as const
export type HomeTab = (typeof HOME_TABS)[number]

/** The id of a tab's button; its panel's id adds `-panel`. */
export const homeTabId = (tab: HomeTab): string => `home-tab-${tab}`

/**
 * Where a "sign in to follow" of the top page leads: the sign-in, which
 * returns to the top page (src/auth/landing.ts).
 */
export const HOME_SIGN_IN_PATH = '/login?to=top'

/**
 * How many recent slides the top page holds room for while they are fetched.
 * It equals RECENT_DECKS_SHOWN (src/share/list-pages.ts), which the server
 * lists; a test keeps the two together, as this file reaches the browser and
 * that one does not.
 */
export const HOME_RECENT_SHOWN = 8

/**
 * How many slides of the communities the visitor follows the top page shows
 * (D-52). For a visitor who follows a community, the section holds room for
 * this many from the start (F31-AC16).
 */
export const HOME_COMMUNITIES_SHOWN = 8

/** The page that lists every community, the newest made first (F30-AC47). */
export const NEW_COMMUNITIES_PATH = '/communities'

/**
 * How many new communities the top page shows, at its foot (F30-AC48). The
 * section holds room for this many from the start, for every visitor.
 */
export const HOME_NEW_COMMUNITIES_SHOWN = 6
