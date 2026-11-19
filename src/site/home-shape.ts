import type { HomeLists } from './home-lists'

/** How many of the visitor's own slides the top page shows. */
export const HOME_OWN_SHOWN = 4

/** How many slides of the people the visitor follows the top page shows. */
export const HOME_FOLLOWING_SHOWN = 4

/** Where this browser keeps the lists' last shape, as the header keeps the session. */
export const HOME_SHAPE_KEY = 'slide:home'

/** Where /share.js keeps the session the header last drew. */
export const SESSION_KEY = 'slide:session'

/** How many cards each list held, kept to draw the same shape while waiting. */
export type HomeShape = Readonly<{ own: number; following: number }>

const cardCount = (value: unknown, most: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0
    ? Math.min(value, most)
    : 0

/**
 * The shape to hold while the lists are fetched, from what this browser
 * kept: the session the header last drew, and the lists' last shape. Both
 * come from storage anyone can write, so nothing in them is trusted; a
 * visitor not known to be signed in gets no placeholder at all.
 */
export function keptHomeShape(
  session: string | null,
  shape: string | null,
): HomeShape {
  const none = { own: 0, following: 0 }
  try {
    if (JSON.parse(session ?? 'null')?.signedIn !== true) return none
    const kept: unknown = JSON.parse(shape ?? 'null')
    if (typeof kept !== 'object' || kept === null) return none
    const { own, following } = kept as Record<string, unknown>
    return {
      own: cardCount(own, HOME_OWN_SHOWN),
      following: cardCount(following, HOME_FOLLOWING_SHOWN),
    }
  } catch {
    return none
  }
}

/** The shape of the lists that came, to keep for the next visit. */
export const homeShapeOf = (lists: HomeLists | null): HomeShape => ({
  own: lists?.own.length ?? 0,
  following: lists?.following.length ?? 0,
})
