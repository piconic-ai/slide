/**
 * How many slides of the people the visitor follows the top page shows. The
 * section holds room for this many from the start, so what comes changes
 * nothing about the page's height.
 */
export const HOME_FOLLOWING_SHOWN = 4

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

/** The page that lists every slide of the communities the visitor follows. */
export const FOLLOWED_COMMUNITY_TALKS_PATH = '/communities/following'

/** The page that lists every community, the newest made first (F30-AC45). */
export const NEW_COMMUNITIES_PATH = '/communities'
