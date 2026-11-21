import MarkdownIt from 'markdown-it'
import type { Token } from 'markdown-it'
import { citationOfHref, type Citation } from '../citations/citation'
import { sharePath } from '../share/path'
import type { Handle } from '../share/handle'
import type { DeckSlug } from '../decks/deck-id'
import { messages, type Lang } from '../site/i18n'

/**
 * The Markdown of an article, turned into HTML the viewer can show. The text
 * is untrusted: it comes from an author, and an AI agent may have written it.
 * So the HTML is never taken from the text. The parser has raw HTML switched
 * off (it is shown as text), and every element and attribute below is written
 * by the renderer rules in this file, not copied from the text. A last check
 * (`onlyAllowed`) refuses any output that holds something else.
 * See docs/dev/f26-article.md.
 */

/** The longest article, in characters (code points). */
export const MAX_ARTICLE_CHARS = 50_000

/** How many different pages an article may show as images. */
export const MAX_EMBEDS = 20

/** What an article may link to; a link of any other kind is shown as text. */
const LINK_TARGET = /^(?:https?:\/\/|mailto:)/i

/** The rel every link in an article carries. */
const LINK_REL = 'noopener nofollow ugc'

const parser = new MarkdownIt('default', {
  // Raw HTML in the text is shown as text.
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
})
// Plain links only: `www.example.com` and bare addresses are no links.
parser.linkify.set({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false })
// Images need uploads, which an article does not have; the text shows as is.
parser.disable('image')
parser.validateLink = (url) => LINK_TARGET.test(url.trim())

const escape = parser.utils.escapeHtml

/** A share URL of one page of a deck, as an article names it. */
export type PageRef = Readonly<{ handle: string; slug: string; page: number }>

/** The key a page is looked up by. */
export const pageKey = (ref: PageRef) => `${ref.handle}/${ref.slug}/${ref.page}`

/** What an embedded page shows. */
export type Embed =
  /** A page of the article's own slides: pressing it moves the slides above. */
  | Readonly<{ kind: 'own'; imageUrl: string }>
  /** A page of another author's public slides. */
  | Readonly<{
      kind: 'other'
      imageUrl: string
      title: string
      /** The author's display name, or null to show the handle. */
      author: string | null
    }>

const text = messages({
  ja: {
    own: (page: number) => `${page} ページ · 押すとスライドがこのページに移る`,
    other: (author: string, title: string, page: number) =>
      `${author}さんの『${title}』${page} ページ`,
    ownLabel: (page: number) => `スライドの ${page} ページへ移る`,
    otherLabel: (author: string, title: string, page: number) =>
      `${author}さんの『${title}』${page} ページを開く`,
  },
  en: {
    own: (page: number) => `Page ${page} · press to move the slides to it`,
    other: (author: string, title: string, page: number) =>
      `“${title}” by ${author}, page ${page}`,
    ownLabel: (page: number) => `Move the slides to page ${page}`,
    otherLabel: (author: string, title: string, page: number) =>
      `Open page ${page} of “${title}” by ${author}`,
  },
})

/** The heading of the text is one level down: the viewer's own is an h2. */
const headingTag = (tag: string) => `h${Math.min(Number(tag.slice(1)) + 2, 6)}`

parser.renderer.rules.heading_open = (tokens, index) =>
  `<${headingTag(tokens[index]!.tag)}>`
parser.renderer.rules.heading_close = (tokens, index) =>
  `</${headingTag(tokens[index]!.tag)}>\n`
// Code keeps its text and nothing of the info line (no class from the text).
parser.renderer.rules.fence = (tokens, index) =>
  `<pre><code>${escape(tokens[index]!.content)}</code></pre>\n`
parser.renderer.rules.code_block = parser.renderer.rules.fence
// A table cell's alignment would be a style attribute; cells carry none.
parser.renderer.rules.th_open = () => '<th>'
parser.renderer.rules.td_open = () => '<td>'
parser.renderer.rules.link_open = (tokens, index) =>
  `<a href="${escape(String(tokens[index]!.attrGet('href') ?? ''))}" rel="${LINK_REL}">`
parser.renderer.rules.ordered_list_open = (tokens, index) => {
  const start = Number(tokens[index]!.attrGet('start'))
  return Number.isSafeInteger(start) && start > 1 && start < 1_000_000_000
    ? `<ol start="${start}">\n`
    : '<ol>\n'
}

type EmbedMeta = Readonly<{ ref: PageRef; embed: Embed; lang: Lang }>

const embedHtml = (ref: PageRef, embed: Embed, lang: Lang) => {
  const t = text[lang]
  const own = embed.kind === 'own'
  const author = own ? '' : (embed.author ?? `@${ref.handle}`)
  const title = own ? '' : embed.title
  const label = own
    ? t.ownLabel(ref.page)
    : t.otherLabel(author, title, ref.page)
  const caption = own ? t.own(ref.page) : t.other(author, title, ref.page)
  const face = own ? `${ref.page}` : `${title} · ${ref.page}`
  const href = sharePath(ref.handle as Handle, ref.slug as DeckSlug, ref.page)
  return (
    `<div class="article-embed">` +
    `<a class="article-embed-link" href="${escape(href)}" aria-label="${escape(label)}"` +
    `${own ? ` data-article-page="${ref.page}"` : ''}>` +
    `<span class="deck-cover"><span class="deck-cover-name" aria-hidden="true">${escape(face)}</span>` +
    `<img data-cover src="${escape(embed.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" /></span>` +
    `</a><p class="article-embed-caption">${escape(caption)}</p></div>\n`
  )
}

parser.renderer.rules.article_embed = (tokens, index) => {
  const { ref, embed, lang } = tokens[index]!.meta as EmbedMeta
  return embedHtml(ref, embed, lang)
}

/** The paragraph's text when the whole paragraph is one bare share URL. */
const lone = /^(?:<(\S+)>|(\S+))$/

/**
 * The page a top-level paragraph shows as an image: one line holding nothing
 * but the share URL of one page of a deck, without a query or a fragment,
 * written as a link the text itself makes. A URL inside a sentence, a
 * Markdown link with words of its own, or a URL of another origin is not one.
 */
function embeddedPage(
  tokens: readonly Token[],
  index: number,
  origin: string,
): PageRef | null {
  const open = tokens[index]
  const inline = tokens[index + 1]
  if (
    open?.type !== 'paragraph_open' ||
    open.level !== 0 ||
    inline?.type !== 'inline' ||
    inline.children?.length !== 3 ||
    inline.children[0]?.type !== 'link_open'
  )
    return null
  const written = lone.exec(inline.content.trim())
  const url = written?.[1] ?? written?.[2]
  if (!url || /[?#]/.test(url) || !/^https?:\/\//i.test(url)) return null
  const cited = citationOfHref(url, origin)
  return cited && cited.page > 0 ? cited : null
}

/**
 * A text parsed once. Reading its pages, its links and drawing it all take
 * this, so a view does the parsing a single time.
 */
export type ParsedArticle = readonly Token[]

/** Parses the text; the result is read by the functions below, never changed. */
export const parseArticle = (source: string): ParsedArticle =>
  parser.parse(source, {})

const parsedOf = (text: string | ParsedArticle) =>
  typeof text === 'string' ? parseArticle(text) : text

/** The pages an article shows as images, each once, in the order written. */
export function embeddedPages(
  text: string | ParsedArticle,
  origin: string,
): PageRef[] {
  const tokens = parsedOf(text)
  const found = new Map<string, PageRef>()
  for (let index = 0; index < tokens.length; index += 1) {
    const ref = embeddedPage(tokens, index, origin)
    if (ref && !found.has(pageKey(ref))) found.set(pageKey(ref), ref)
  }
  return [...found.values()].slice(0, MAX_EMBEDS)
}

/**
 * Every share URL the text links to, a link in a sentence as much as a page
 * shown as an image, each once, in the order written. Links inside code are
 * text and give none.
 */
export function linkedShareUrls(
  text: string | ParsedArticle,
  origin: string,
): Citation[] {
  const found = new Map<string, Citation>()
  const visit = (tokens: readonly Token[]) => {
    for (const token of tokens) {
      if (token.type === 'link_open') {
        const cited = citationOfHref(
          String(token.attrGet('href') ?? ''),
          origin,
        )
        if (cited && !found.has(pageKey(cited)))
          found.set(pageKey(cited), cited)
      }
      if (token.children) visit(token.children)
    }
  }
  visit(parsedOf(text))
  return [...found.values()]
}

/** What the renderer needs besides the text. */
export type ArticleView = Readonly<{
  /** The service's origin, which a share URL starts with. */
  origin: string
  /** The pages to show as images, by `pageKey`; any other page is a link. */
  embeds: ReadonlyMap<string, Embed>
  lang: Lang
}>

/** The elements and attributes an article may hold, and no others. */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  p: ['class'],
  h3: [],
  h4: [],
  h5: [],
  h6: [],
  ul: [],
  ol: ['start'],
  li: [],
  blockquote: [],
  pre: [],
  code: [],
  em: [],
  strong: [],
  s: [],
  br: [],
  hr: [],
  table: [],
  thead: [],
  tbody: [],
  tr: [],
  th: [],
  td: [],
  a: ['href', 'rel', 'class', 'aria-label', 'data-article-page'],
  div: ['class'],
  span: ['class', 'aria-hidden'],
  img: ['data-cover', 'src', 'alt', 'loading', 'referrerpolicy'],
}

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)\s*\/?>/g
const ATTRIBUTE =
  /([a-zA-Z][a-zA-Z0-9_:-]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?/g

/**
 * Whether HTML holds only the elements and attributes an article may. The
 * renderer writes nothing else, so this is a second lock on the door, not the
 * first: any `<` that is not a tag of the list, an unquoted or odd attribute,
 * an event handler, a `style`, fails it.
 */
export function onlyAllowed(output: string): boolean {
  const withoutTags = output.replace(TAG, (_all, closing, name, rest) => {
    const attributes = ALLOWED[String(name).toLowerCase()]
    if (!attributes) return '\u0000'
    if (closing && String(rest).trim() !== '') return '\u0000'
    const leftover = String(rest).replace(ATTRIBUTE, (_one, attribute) =>
      attributes.includes(String(attribute).toLowerCase()) ? '' : '\u0000',
    )
    return leftover.trim() === '' ? '' : '\u0000'
  })
  return !withoutTags.includes('<') && !withoutTags.includes('\u0000')
}

/** The text the tokens were made from, for showing it as it was written. */
const sourceOf = (tokens: readonly Token[]) =>
  tokens
    .filter((token) => token.type === 'inline')
    .map((token) => token.content)
    .join('\n\n')

/** The text shown as itself, when nothing else can be trusted. */
const asPlainText = (source: string) =>
  `<p>${escape(source).replaceAll('\n', '<br>\n')}</p>`

/**
 * The HTML of an article. A page in `embeds` replaces the paragraph that
 * holds only its share URL; every other URL stays a link. The result holds
 * only the elements and attributes of `ALLOWED`; if it ever did not, the text
 * is shown as plain text instead.
 */
export function renderArticle(
  text: string | ParsedArticle,
  view: ArticleView,
): string {
  const tokens = parsedOf(text)
  const shown: Token[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const ref = embeddedPage(tokens, index, view.origin)
    const embed = ref && view.embeds.get(pageKey(ref))
    if (ref && embed) {
      // A copy, so that the parsed text is left as it was.
      const token = Object.assign(
        Object.create(Object.getPrototypeOf(tokens[index])),
        tokens[index],
      ) as Token
      token.type = 'article_embed'
      token.meta = { ref, embed, lang: view.lang } satisfies EmbedMeta
      shown.push(token)
      // The paragraph's three tokens give one.
      index += 2
    } else shown.push(tokens[index]!)
  }
  const output = parser.renderer.render(shown, parser.options, {})
  return onlyAllowed(output)
    ? output
    : asPlainText(typeof text === 'string' ? text : sourceOf(tokens))
}
