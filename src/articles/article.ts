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

/** The state of an article that is there. */
export type KeptState = Exclude<ArticleState, 'none'>

export const keptStateOf = (article: ArticleFields): KeptState =>
  article.status === 'draft'
    ? 'draft'
    : article.draftBody === null
      ? 'published'
      : 'pending'

export const stateOf = (article: ArticleFields | null): ArticleState =>
  article === null ? 'none' : keptStateOf(article)

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
 *   the author was editing (the text sent, else the pending edit).
 *
 * Autosaving a text applies to every state, so it always has a result.
 */
export function nextFields(
  current: ArticleFields | null,
  action: 'autosave',
  sent: string,
): ArticleFields
export function nextFields(
  current: ArticleFields | null,
  action: ArticleAction,
  sent: string | null,
): ArticleFields | null
export function nextFields(
  current: ArticleFields | null,
  action: ArticleAction,
  sent: string | null,
): ArticleFields | null {
  const held = current?.status === 'published' ? current : null
  switch (action) {
    case 'autosave':
      return sent === null ? null : afterAutosave(current, held, sent)
    case 'publish':
      // A draft is published as it is kept when no text is sent.
      return publishedWith(
        sent ?? (current?.status === 'draft' ? current.body : null),
      )
    case 'update':
      return held && sent !== null ? publishedWith(sent) : null
    case 'discard':
      return held && { ...held, draftBody: null }
    case 'unpublish':
      return (
        held && {
          body: sent ?? held.draftBody ?? held.body,
          draftBody: null,
          status: 'draft',
        }
      )
  }
}

const publishedWith = (body: string | null): ArticleFields | null =>
  body === null ? null : { body, draftBody: null, status: 'published' }

/** The text goes where readers do not see it; see `nextFields`. */
function afterAutosave(
  current: ArticleFields | null,
  held: ArticleFields | null,
  sent: string,
): ArticleFields {
  if (held === null || current === null)
    return { body: sent, draftBody: null, status: 'draft' }
  return {
    body: held.body,
    draftBody: sent === held.body ? null : sent,
    status: 'published',
  }
}

/** The button of the editing page a form field names, or null. */
export const buttonOf = (value: unknown): 'update' | 'discard' | null =>
  value === 'update' || value === 'discard' ? value : null

/** The button of the slide's page a form field names, or null. */
export const publicationOf = (value: unknown): 'publish' | 'unpublish' | null =>
  value === 'publish' || value === 'unpublish' ? value : null

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
