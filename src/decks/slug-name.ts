import { deckSlugSchema, type DeckSlug } from './binding'

/** How long a slug may be; see the pattern in ./binding. */
const MAX_SLUG_LENGTH = 64
/** The name of a slide nothing else names. */
const FALLBACK = 'slide'

/**
 * Names a slide cannot have, because a fixed path sits where its pages
 * would: /slides/new and /slides/connect among the author's pages, and
 * /@handle/following and /@handle/followers among the reader's.
 */
const RESERVED: ReadonlySet<string> = new Set([
  'new',
  'connect',
  'following',
  'followers',
])

export const isReservedSlug = (slug: string): boolean => RESERVED.has(slug)

const trimHyphens = (text: string) => text.replace(/^-+|-+$/g, '')

/**
 * The slug a piece of text spells: its letters and digits in lowercase,
 * everything else as single hyphens. Null when nothing is left, as for a
 * title written only in Japanese.
 */
export function slugOf(text: string): DeckSlug | null {
  const spelled = trimHyphens(
    trimHyphens(
      text
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-'),
    ).slice(0, MAX_SLUG_LENGTH),
  )
  const slug = deckSlugSchema.safeParse(spelled)
  return slug.success ? slug.data : null
}

/** A file's name without its folders and its last extension. */
const stem = (fileName: string) =>
  (fileName.split(/[\\/]/).at(-1) ?? '').replace(/\.[^.]*$/, '')

export type SlideName = Readonly<{
  /** The <title> of the slide's index.html. */
  title?: string | null
  /** The name of the file that was dropped, HTML or zip. */
  fileName?: string | null
}>

/**
 * The slug to start from for a new slide: the first of its title, the name
 * of the dropped file and `slide` that spells one.
 */
export function slugBase(name: SlideName): DeckSlug {
  return (
    (name.title ? slugOf(name.title) : null) ??
    (name.fileName ? slugOf(stem(name.fileName)) : null) ??
    deckSlugSchema.parse(FALLBACK)
  )
}

/** `base` with a number after it, cut so the whole still fits. */
function numbered(base: string, number: number): DeckSlug {
  const suffix = `-${number}`
  return deckSlugSchema.parse(
    trimHyphens(base.slice(0, MAX_SLUG_LENGTH - suffix.length)) + suffix,
  )
}

/**
 * The first of `base`, `base-2`, `base-3`, … that the author does not use
 * yet and that is not reserved.
 */
export function freeSlug(base: DeckSlug, taken: ReadonlySet<string>): DeckSlug {
  const free = (slug: string) => !taken.has(slug) && !isReservedSlug(slug)
  if (free(base)) return base
  // Among `taken.size + 2` different names, one is neither taken nor the
  // base, so the loop ends.
  for (let number = 2; ; number++) {
    const candidate = numbered(base, number)
    if (free(candidate)) return candidate
  }
}

export type SlugChange =
  | Readonly<{ ok: true; slug: DeckSlug }>
  | Readonly<{ ok: false; reason: 'invalid' | 'reserved' }>

/**
 * Checks a name the author typed. Nothing is added to it: a reserved name
 * is refused, since the author is choosing and would not expect another.
 */
export function chosenSlug(input: string): SlugChange {
  const slug = deckSlugSchema.safeParse(input.trim())
  if (!slug.success) return { ok: false, reason: 'invalid' }
  if (isReservedSlug(slug.data)) return { ok: false, reason: 'reserved' }
  return { ok: true, slug: slug.data }
}

/** What changing a slide's URL name came to, as the page says it. */
export const SLUG_NOTICES = [
  'renamed',
  'invalid',
  'reserved',
  'taken',
  'published',
] as const
export type SlugNotice = (typeof SLUG_NOTICES)[number]

/** Reads the notice a redirect carries; anything else is no notice. */
export const parseSlugNotice = (value: unknown): SlugNotice | null =>
  typeof value === 'string' &&
  (SLUG_NOTICES as readonly string[]).includes(value)
    ? (value as SlugNotice)
    : null
