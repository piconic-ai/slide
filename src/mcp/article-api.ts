import { checkBody } from '../articles/article'
import { MAX_ARTICLE_CHARS } from '../articles/markdown'
import { autosaveArticle, readArticle } from '../articles/store'
import { resolveDeck } from '../decks/store'
import {
  LINK_REFUSALS,
  MAX_LINKS,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
  parseLinkInput,
  type LinkRefusal,
} from '../links/link'
import { addLink, listLinks, removeLink } from '../links/store'
import { record } from '../metrics/record-routes'
import { readCalendarsForEventSoon } from '../feeds/reader-routes'
import {
  draftView,
  REVISION_MESSAGES,
  writeBasis,
  writtenView,
  type ArticleUrls,
} from './article-draft'
import { refusalResult, toolError, toolResult, type ToolResult } from './tools'

/** What the article and link tools need of the request they serve. */
type Session = Readonly<{ env: Env; ownerUserId: string }>

const now = () => Math.floor(Date.now() / 1000)

const editUrl = (origin: string, slug: string, path: string) =>
  new URL(`/my/slides/${slug}${path}`, origin).href

const LINK_MESSAGES: Readonly<Record<LinkRefusal, string>> = {
  kind: '`kind` must be one of video, article, event or other.',
  url_invalid: 'The URL is not a valid absolute URL without spaces.',
  url_scheme: 'Only https: URLs are taken. Ask the author for an https: URL.',
  url_credentials: 'A URL with a user name or password is not taken.',
  url_too_long: `The URL is longer than ${MAX_URL_LENGTH} characters.`,
  title_missing:
    'The title has no character a reader can see. Leave `title` out to show the site name.',
  title_too_long: `The title is longer than ${MAX_TITLE_LENGTH} characters.`,
  title_invalid:
    'The title holds control, invisible or line-breaking characters.',
}
// Every refusal of the parser has a sentence here.
void (LINK_REFUSALS satisfies readonly (keyof typeof LINK_MESSAGES)[])

/** The article's editing page and the slide's manage page. */
const articleUrls = (origin: string, slug: string): ArticleUrls => ({
  editUrl: editUrl(origin, slug, '/article'),
  manageUrl: editUrl(origin, slug, ''),
})

/**
 * Reads the slide's article as the author is editing it: a draft's text, or
 * for a published article the author's working draft, else the published
 * text; with the revision a write is to be based on.
 */
export async function getArticleDraft(
  { env, ownerUserId }: Session,
  slug: string,
): Promise<ToolResult> {
  const deck = await resolveDeck(env.DB, ownerUserId, slug)
  // Unknown, foreign and deleted slides are the same answer.
  if (!deck || deck.deleted) return toolError('unknown_slide')
  const [article, links] = await Promise.all([
    readArticle(env.DB, deck.id),
    linksView(env, deck.id),
  ])
  return toolResult(
    draftView(
      deck.slug,
      articleUrls(env.PUBLIC_ORIGIN, deck.slug),
      article,
      links,
    ),
  )
}

/**
 * Writes the text where readers do not see it, as the editing page's
 * autosave does: a new draft, a draft's own text, or a published article's
 * working draft. A slide with an article is written only at the revision
 * the agent read, in the same statement (D-71).
 */
export async function putArticleDraft(
  { env, ownerUserId }: Session,
  slug: string,
  body: string,
  revision: number | undefined,
): Promise<ToolResult> {
  const deck = await resolveDeck(env.DB, ownerUserId, slug)
  if (!deck || deck.deleted) return toolError('unknown_slide')
  const checked = checkBody(body, { publishing: false })
  if (!checked.ok)
    return refusalResult(
      'body_too_long',
      `The text is longer than ${MAX_ARTICLE_CHARS} characters. Shorten it and call put_article_draft again.`,
    )
  const current = await readArticle(env.DB, deck.id)
  const basis = writeBasis(current?.revision ?? null, revision)
  if (!basis.ok)
    return refusalResult(basis.reason, REVISION_MESSAGES[basis.reason])
  const saved = await autosaveArticle(env.DB, {
    deckId: deck.id,
    body: checked.body,
    known: basis.known,
    now: now(),
  })
  if (saved.result === 'conflict')
    return refusalResult(
      'revision_mismatch',
      REVISION_MESSAGES.revision_mismatch,
    )
  return toolResult(
    writtenView(
      deck.slug,
      articleUrls(env.PUBLIC_ORIGIN, deck.slug),
      current,
      checked.body,
      saved.revision,
    ),
  )
}

async function linksView(env: Env, deckId: string) {
  return (await listLinks(env.DB, deckId)).map(({ id, kind, url, title }) => ({
    id,
    kind,
    url,
    title,
  }))
}

/** Adds a related link to the slide, last in order. */
export async function addRelatedLink(
  { env, ownerUserId }: Session,
  slug: string,
  input: Readonly<{ kind?: unknown; url: unknown; title?: unknown }>,
): Promise<ToolResult> {
  const deck = await resolveDeck(env.DB, ownerUserId, slug)
  if (!deck || deck.deleted) return toolError('unknown_slide')
  const parsed = parseLinkInput({ ...input, title: input.title ?? '' })
  if (!parsed.ok)
    return refusalResult(`link_${parsed.reason}`, LINK_MESSAGES[parsed.reason])
  const result = await addLink(env.DB, {
    deckId: deck.id,
    ownerUserId,
    link: parsed.link,
    now: now(),
  })
  if (result === 'missing') return toolError('unknown_slide')
  if (result === 'added')
    record(env, { name: 'related_link_added', deckId: deck.id })
  if (result === 'duplicate')
    return refusalResult(
      'link_duplicate',
      'The slide already has a related link to this address (compared after normalization: tracking parts, www., a trailing slash and the like do not count). Nothing was added. Tell the author the link is there already.',
    )
  // The calendars are read by the next Cron Trigger; a tool call has no
  // waitUntil to read them after its answer.
  if (result === 'added' && parsed.link.kind === 'event')
    await readCalendarsForEventSoon(env, null, parsed.link.event)
  if (result === 'full')
    return refusalResult(
      'links_full',
      `The slide already has ${MAX_LINKS} related links, the most it may have. Call remove_related_link to make room.`,
    )
  return toolResult({
    slide: deck.slug,
    links: await linksView(env, deck.id),
    // 'given' (the title passed in) or 'none' (no title: the link shows its
    // site name). The service never reads the linked page.
    titleSource:
      parsed.link.title === null ? ('none' as const) : ('given' as const),
    editUrl: editUrl(env.PUBLIC_ORIGIN, deck.slug, '#links'),
    nextStep:
      'The link is on the slide’s manage page and shows under the title in the viewer. Tell the author where to check it (editUrl); they can also remove it there. If titleSource is none, the link shows its site name: pass a title to add_related_link again after remove_related_link if the author wants one.',
  })
}

/** Removes one related link of the slide. */
export async function removeRelatedLink(
  { env, ownerUserId }: Session,
  slug: string,
  linkId: string,
): Promise<ToolResult> {
  const deck = await resolveDeck(env.DB, ownerUserId, slug)
  if (!deck || deck.deleted) return toolError('unknown_slide')
  const result = await removeLink(env.DB, {
    deckId: deck.id,
    ownerUserId,
    linkId,
  })
  if (result === 'missing')
    return refusalResult(
      'unknown_link',
      'The slide has no related link with that id. Its links are listed in the answer of add_related_link.',
    )
  return toolResult({
    slide: deck.slug,
    links: await linksView(env, deck.id),
    editUrl: editUrl(env.PUBLIC_ORIGIN, deck.slug, '#links'),
    nextStep:
      'The link is gone from the slide’s manage page and the viewer. Tell the author where to check it (editUrl).',
  })
}
