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
