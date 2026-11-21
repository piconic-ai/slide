import { checkBody } from '../articles/article'
import { MAX_ARTICLE_CHARS } from '../articles/markdown'
import { keepArticle, readArticle } from '../articles/store'
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
import { refusalResult, toolError, toolResult, type ToolResult } from './tools'

/** What the article and link tools need of the request they serve. */
type Session = Readonly<{ env: Env; ownerUserId: string }>

const now = () => Math.floor(Date.now() / 1000)

const editUrl = (origin: string, slug: string, path: string) =>
  new URL(`/slides/${slug}${path}`, origin).href

const LINK_MESSAGES: Readonly<Record<LinkRefusal, string>> = {
  kind: '`kind` must be one of video, article or other.',
  url_invalid: 'The URL is not a valid absolute URL without spaces.',
  url_scheme: 'Only https: URLs are taken. Ask the author for an https: URL.',
  url_credentials: 'A URL with a user name or password is not taken.',
  url_too_long: `The URL is longer than ${MAX_URL_LENGTH} characters.`,
  title_missing: 'The link needs a visible title.',
  title_too_long: `The title is longer than ${MAX_TITLE_LENGTH} characters.`,
  title_invalid:
    'The title holds control, invisible or line-breaking characters.',
}
// Every refusal of the parser has a sentence here.
void (LINK_REFUSALS satisfies readonly (keyof typeof LINK_MESSAGES)[])

/**
 * Puts the text up as the slide's article draft. A draft the author already
 * has is replaced; a published article is never touched (D-71).
 */
export async function putArticleDraft(
  { env, ownerUserId }: Session,
  slug: string,
  body: string,
): Promise<ToolResult> {
  const deck = await resolveDeck(env.DB, ownerUserId, slug)
  // Unknown, foreign and deleted slides are the same answer.
  if (!deck || deck.deleted) return toolError('unknown_slide')
  const url = editUrl(env.PUBLIC_ORIGIN, deck.slug, '/article')
  const checked = checkBody(body, { publishing: false })
  if (!checked.ok)
    return refusalResult(
      'body_too_long',
      `The text is longer than ${MAX_ARTICLE_CHARS} characters. Shorten it and call put_article_draft again.`,
    )
  const current = await readArticle(env.DB, deck.id)
  if (current?.status === 'published')
    return refusalResult(
      'article_published',
      `This slide’s article is published, so it was not changed. Ask the author to edit it on the article page: ${url}`,
    )
  await keepArticle(env.DB, {
    deckId: deck.id,
    body: checked.body,
    status: 'draft',
    // A draft holds no citations.
    citations: [],
    now: now(),
  })
  return toolResult({
    slide: deck.slug,
    status: 'draft' as const,
    editUrl: url,
    nextStep:
      'The text is saved as a draft that only the author sees. Ask the author to open editUrl, read and preview it, and press Publish there. Nothing is public until they do.',
  })
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
  input: Readonly<{ kind: unknown; url: unknown; title: unknown }>,
): Promise<ToolResult> {
  const deck = await resolveDeck(env.DB, ownerUserId, slug)
  if (!deck || deck.deleted) return toolError('unknown_slide')
  const parsed = parseLinkInput(input)
  if (!parsed.ok)
    return refusalResult(`link_${parsed.reason}`, LINK_MESSAGES[parsed.reason])
  const result = await addLink(env.DB, {
    deckId: deck.id,
    ownerUserId,
    link: parsed.link,
    now: now(),
  })
  if (result === 'missing') return toolError('unknown_slide')
  if (result === 'full')
    return refusalResult(
      'links_full',
      `The slide already has ${MAX_LINKS} related links, the most it may have. Call remove_related_link to make room.`,
    )
  return toolResult({
    slide: deck.slug,
    links: await linksView(env, deck.id),
    editUrl: editUrl(env.PUBLIC_ORIGIN, deck.slug, '#links'),
    nextStep:
      'The link is on the slide’s manage page and shows under the title in the viewer. Tell the author where to check it (editUrl); they can also remove it there.',
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
