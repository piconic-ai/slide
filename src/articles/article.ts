import { MAX_ARTICLE_CHARS } from './markdown'

/** What an article's author may do with it; a draft is the author's alone. */
export type ArticleStatus = 'draft' | 'published'

/** A body that can be kept, or the reason it cannot. */
export type BodyCheck =
  | Readonly<{ ok: true; body: string }>
  | Readonly<{ ok: false; reason: 'too_long' | 'empty' }>

/**
 * The text as it is kept: line ends are `\n` (a form sends `\r\n`), and the
 * null character, which no text holds, is dropped.
 */
export const normalizeBody = (raw: string) =>
  raw.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\u0000', '')

/** The length in characters, an emoji counting as one as the database does. */
export const bodyLength = (body: string) => {
  let count = 0
  for (const _ of body) count += 1
  return count
}

/**
 * Whether the body may be kept: at most 50,000 characters, exactly that many
 * included. A body to be published must also have something in it, or readers
 * would find a heading over nothing.
 */
export function checkBody(
  raw: string,
  { publishing }: Readonly<{ publishing: boolean }>,
): BodyCheck {
  const body = normalizeBody(raw)
  // A text of at most that many UTF-16 units cannot have more characters.
  const long =
    body.length > MAX_ARTICLE_CHARS && bodyLength(body) > MAX_ARTICLE_CHARS
  if (long) return { ok: false, reason: 'too_long' }
  if (publishing && body.trim() === '') return { ok: false, reason: 'empty' }
  return { ok: true, body }
}

/** What an article holds: what readers see, and an edit not yet shown. */
export type ArticleFields = Readonly<{
  /** What readers see while the article is published; the draft's own text otherwise. */
  body: string
  /** The edit of a published article; null for a draft and when nothing is pending. */
  draftBody: string | null
  status: ArticleStatus
}>

/**
 * What the author sees an article as: none yet, a draft, published, or
 * published with an edit that readers do not see yet.
 */
export type ArticleState = 'none' | 'draft' | 'published' | 'pending'

export const stateOf = (article: ArticleFields | null): ArticleState =>
  article === null
    ? 'none'
    : article.status === 'draft'
      ? 'draft'
      : article.draftBody === null
        ? 'published'
        : 'pending'

/** The text the editing page opens: the pending edit, else what is kept. */
export const editingBody = (article: ArticleFields | null) =>
  article === null ? '' : (article.draftBody ?? article.body)

/** What the author asks for with a button; autosave is the page's own. */
export type ArticleAction =
  | 'autosave'
  | 'publish'
  | 'update'
  | 'discard'
  | 'unpublish'

/**
 * What the article holds after an action, or null where the action does not
 * apply to the state (updating a draft, discarding nothing). This is the
 * rule the store's statements follow, and what its tests are checked against.
 *
 * - autosave writes the text where readers do not see it: into the draft
 *   itself, or for a published article into its pending edit (which is
 *   dropped when it equals the published text);
 * - publish makes a draft public with the text sent, and update does the
 *   same for the pending edit of a published article;
 * - discard drops the pending edit, and the published text stands;
 * - unpublish makes the published article a draft again, holding the text
 *   the author was editing.
 */
export function nextFields(
  current: ArticleFields | null,
  action: ArticleAction,
  sent: string | null,
): ArticleFields | null {
  const published = current?.status === 'published'
  switch (action) {
    case 'autosave':
      if (sent === null) return null
      if (!published) return { body: sent, draftBody: null, status: 'draft' }
      return {
        body: current.body,
        draftBody: sent === current.body ? null : sent,
        status: 'published',
      }
    case 'publish':
      return sent === null
        ? null
        : { body: sent, draftBody: null, status: 'published' }
    case 'update':
      return !published || sent === null
        ? null
        : { body: sent, draftBody: null, status: 'published' }
    case 'discard':
      return published ? { ...current, draftBody: null } : null
    case 'unpublish':
      return published
        ? {
            body: current.draftBody ?? current.body,
            draftBody: null,
            status: 'draft',
          }
        : null
  }
}

/** The button a form field names, or null for any other word. */
export const buttonOf = (
  value: unknown,
): Exclude<ArticleAction, 'autosave'> | null =>
  value === 'publish' ||
  value === 'update' ||
  value === 'discard' ||
  value === 'unpublish'
    ? value
    : null

/**
 * Whether a write made from a screen that loaded the article at `known`
 * (null: it had none) still fits what is stored: any change since, from
 * another tab, makes it stale.
 */
export const isStale = (known: number | null, stored: number | null) =>
  known !== stored

/** Reads the revision a form carries: a whole number, or null for none. */
export function revisionOf(value: unknown): number | null | undefined {
  if (value === '' || value === undefined) return null
  if (typeof value !== 'string' || !/^[0-9]{1,9}$/.test(value)) return undefined
  return Number(value)
}

/**
 * The pages an article shows as images that the shown version does not
 * have, in the order written. Without a count of pages, none is missing:
 * the service does not take a deck's number of pages yet, so every page is
 * taken to be there (see docs/dev/f26-article.md).
 */
export function missingPages<T extends Readonly<{ page: number }>>(
  pages: readonly T[],
  pageCount: number | null,
): T[] {
  return pageCount === null ? [] : pages.filter((ref) => ref.page > pageCount)
}
