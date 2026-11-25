import { profilePath } from '../share/path'
import type { Handle } from '../share/handle'
import {
  COMMUNITY_COLORS,
  coverShades,
  type CommunityColor,
} from '../site/cover-pattern'
import { coverPath, logoPath } from './community'
import { initialOf, letterTone, type LetterTone } from './logo'

/** A community as a list of new communities reads it from D1. */
export type ListedCommunity = Readonly<{
  id: number
  handle: Handle
  name: string
  description: string
  color: CommunityColor
  logoAt: number | null
  coverAt: number | null
}>

/**
 * A card's cover: the uploaded image, or the default pattern as the
 * community's page draws it on a narrow screen, eight squares in two rows
 * (D-46), each named by the class of its shade.
 */
export type CardCover =
  | Readonly<{ kind: 'image'; url: string }>
  | Readonly<{ kind: 'pattern'; squares: readonly string[] }>

/** A card's logo: the uploaded one, or the initial on its color (D-48). */
export type CardLogo =
  | Readonly<{ kind: 'image'; url: string }>
  | Readonly<{ kind: 'initial'; letter: string; className: string }>

/** One card of a list of communities, ready to draw as is (F30-AC44). */
export type CommunityCard = Readonly<{
  href: string
  name: string
  description: string
  cover: CardCover
  logo: CardLogo
}>

/** The shades of a color, as the suffixes of its tokens: light, mid, dark. */
const SHADE_SUFFIXES = ['-light', '', '-dark'] as const

/** How many squares a card's pattern has across, in each of its two rows. */
export const CARD_COVER_ACROSS = 8

/** The class that paints a square, or an initial's ground, in a shade. */
const toneClass = (color: CommunityColor, suffix: string) =>
  `tone-${color}${suffix}`

/**
 * The squares a card shows: the first eight of each row of sixteen, the ones
 * the community's page keeps on a narrow screen.
 */
export const cardSquares = (
  color: CommunityColor,
  seed: number,
): readonly string[] =>
  coverShades(seed)
    .filter((_, index) => index % (CARD_COVER_ACROSS * 2) < CARD_COVER_ACROSS)
    .map((shade) => toneClass(color, SHADE_SUFFIXES[shade] ?? ''))

const toneText: Readonly<Record<LetterTone, string>> = {
  background: 'tone-text-background',
  foreground: 'tone-text-foreground',
}

/** A listed community as its card shows it. */
export const toCommunityCard = (community: ListedCommunity): CommunityCard => ({
  href: profilePath(community.handle),
  name: community.name,
  description: community.description,
  cover:
    community.coverAt === null
      ? {
          kind: 'pattern',
          squares: cardSquares(community.color, community.id),
        }
      : { kind: 'image', url: coverPath(community.id, community.coverAt) },
  logo:
    community.logoAt === null
      ? {
          kind: 'initial',
          letter: initialOf(community.name),
          className: `${toneClass(community.color, '')} ${toneText[letterTone(community.color)]}`,
        }
      : { kind: 'image', url: logoPath(community.id, community.logoAt) },
})

/**
 * The rules that paint each shade of each color, and an initial's letter in
 * the tone that stands out on its ground. Only the cards' pattern and logo
 * use them (D-13).
 */
export const toneCss = [
  ...COMMUNITY_COLORS.flatMap((color) =>
    SHADE_SUFFIXES.map(
      (suffix) =>
        `.${toneClass(color, suffix)} { background: var(--community-${color}${suffix}); }`,
    ),
  ),
  `.${toneText.background} { color: var(--background); }`,
  `.${toneText.foreground} { color: var(--foreground); }`,
].join('\n')
