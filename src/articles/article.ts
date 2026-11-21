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

/** What the author asks for on the editing page. */
export type ArticleAction = 'save' | 'publish' | 'unpublish'

/**
 * The state an article is in after the author's action: saving keeps the
 * state it had (an article saved the first time is a draft), publishing
 * makes it public, and unpublishing makes it a draft again.
 */
export function statusAfter(
  current: ArticleStatus | null,
  action: ArticleAction,
): ArticleStatus {
  switch (action) {
    case 'save':
      return current ?? 'draft'
    case 'publish':
      return 'published'
    case 'unpublish':
      return 'draft'
  }
}

/** The action a form field names, or null for any other word. */
export const actionOf = (value: unknown): ArticleAction | null =>
  value === 'save' || value === 'publish' || value === 'unpublish'
    ? value
    : null

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
