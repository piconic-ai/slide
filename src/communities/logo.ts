import { html } from 'hono/html'
import type { CommunityColor } from '../site/cover-pattern'
import { designTokensCss } from '../site/design-tokens'
import { logoPath, type Community } from './community'

/** The value of a color token, as `designTokensCss` declares it. */
function tokenValue(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6});`, 'u').exec(
    designTokensCss,
  )
  if (!match?.[1]) throw new Error(`no color token --${name}`)
  return match[1]
}

/** The relative luminance of an sRGB color written #rrggbb (WCAG 2). */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

/** The contrast ratio of two colors written #rrggbb (WCAG 2). */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}

/** The two colors an initial may be written in: the page's white or ink. */
export type LetterTone = 'background' | 'foreground'

/** How much each tone stands out on a community's middle shade. */
export const letterContrasts = (color: CommunityColor) => {
  const ground = tokenValue(`community-${color}`)
  return {
    background: contrastRatio(ground, tokenValue('background')),
    foreground: contrastRatio(ground, tokenValue('foreground')),
  }
}

/**
 * The tone an initial is written in on a community's middle shade (D-48):
 * white or ink, whichever stands out more.
 */
export function letterTone(color: CommunityColor): LetterTone {
  const contrast = letterContrasts(color)
  return contrast.background >= contrast.foreground
    ? 'background'
    : 'foreground'
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * The first letter of a name as a person sees it (one grapheme, so an emoji
 * or a letter with marks stays whole), in upper case where it has one.
 */
export function initialOf(name: string): string {
  const first = segmenter.segment(name.trim())[Symbol.iterator]().next()
  return first.done ? '' : first.value.segment.toUpperCase()
}

/** The sizes a logo is drawn at: the community's page, a list, a row. */
export type LogoSize = 96 | 48 | 28

/**
 * A community's logo: the uploaded one, or the initial of its name on its
 * middle shade (D-48). It stands beside the name, which says the same, so
 * it is hidden from screen readers.
 */
export function communityLogo(
  input: Readonly<{
    name: string
    color: CommunityColor
    logoUrl: string | null
    size: LogoSize
  }>,
) {
  if (input.logoUrl !== null)
    return html`<img
      class="community-logo community-logo-${input.size}"
      src="${input.logoUrl}"
      alt=""
      width="${input.size}"
      height="${input.size}"
    />`
  return html`<span
    class="community-logo community-logo-${input.size}"
    style="background: var(--community-${input.color}); color: var(--${letterTone(input.color)})"
    aria-hidden="true"
    >${initialOf(input.name)}</span
  >`
}

/** A community's logo at a size: its uploaded one, or its initial. */
export const logoOf = (
  community: Pick<Community, 'id' | 'name' | 'color' | 'logoAt'>,
  size: LogoSize,
) =>
  communityLogo({
    name: community.name,
    color: community.color,
    logoUrl:
      community.logoAt === null
        ? null
        : logoPath(community.id, community.logoAt),
    size,
  })
