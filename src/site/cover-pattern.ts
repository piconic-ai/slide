import { html } from 'hono/html'

/** The five colors of a community (D-45), named as their tokens are. */
export const COMMUNITY_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'navy',
] as const
export type CommunityColor = (typeof COMMUNITY_COLORS)[number]

/** The three shades of a color, as the suffixes of its tokens. */
const SHADES = ['-light', '', '-dark'] as const

/** How many squares the pattern has: two rows of sixteen on a wide screen. */
export const COVER_SQUARES = 32

/**
 * A sequence of numbers in [0, 1) that the same seed always gives (a
 * mulberry32 generator), so a pattern is the same on every visit.
 */
function seeded(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The shade of each square, in order, from the seed. */
export const coverShades = (seed: number): readonly number[] => {
  const next = seeded(seed)
  return Array.from({ length: COVER_SQUARES }, () =>
    Math.min(SHADES.length - 1, Math.floor(next() * SHADES.length)),
  )
}

/**
 * The default cover (D-46): rounded squares in the three shades of one color,
 * two rows of sixteen, or of eight on a screen 600px wide or less (the page's
 * style hides the rest). The squares are decoration: the whole is one image
 * named by `label`.
 */
export const coverPattern = (
  input: Readonly<{ color: CommunityColor; seed: number; label: string }>,
) =>
  html`<div class="cover-pattern" role="img" aria-label="${input.label}">
    ${coverShades(input.seed).map(
      (shade) =>
        html`<span
          style="background: var(--community-${input.color}${SHADES[shade] ?? ''})"
        ></span>`,
    )}
  </div>`

/**
 * A cover as a page shows it: the default pattern of a color and a seed, or
 * an uploaded image. A community's page and an event's page both draw it.
 */
export type Cover =
  | Readonly<{ kind: 'pattern'; color: CommunityColor; seed: number }>
  | Readonly<{ kind: 'image'; url: string }>

/** Draws a cover, the whole named by `label`. */
export const coverOf = (cover: Cover, label: string) =>
  cover.kind === 'pattern'
    ? coverPattern({ ...cover, label })
    : html`<img
        class="cover-image"
        src="${cover.url}"
        alt="${label}"
        referrerpolicy="no-referrer"
      />`
