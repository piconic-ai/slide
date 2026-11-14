import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import { deckIdSchema } from '../decks/binding'
import { handleSchema } from '../share/handle'
import { sharePath } from '../share/path'
import { messages, type Lang } from '../site/i18n'
import type { Shortened } from './citing'
import type { TimelineItem } from './timeline'
import { embedUrl, EMBED_ORIGINS, postUrl, type Post } from './post'
import type { DeckLink, StoredPost } from './store'

type Markup = HtmlEscapedString | Promise<HtmlEscapedString> | string

/** What the viewer shows around a deck. */
export type ReactionsView = Readonly<{
  /** Posts about the deck, newest first. */
  timeline: readonly TimelineItem[]
  /** The latest public decks that link to this deck. */
  citedBy: Shortened<CitedView>
  /** The latest public decks this deck links to. */
  cites: Shortened<CitedView>
}>

/** A deck on the other side of a citation, and where it is served from. */
export type CitedView = Readonly<{
  handle: string
  slug: string
  title: string | null
  contentUrl: string
}>

const services = { x: 'X', bluesky: 'Bluesky' } as const

const text = messages({
  ja: {
    heading: 'このスライドへの反応',
    timeline: (count: number) => `反応 ${count}`,
    empty:
      'まだ反応はありません。このスライドについての SNS の投稿がここに並びます。',
    whole: 'スライド全体',
    page: (page: number) => `${page} ページ`,
    citedBy: 'このスライドを引用しているスライド',
    more: (count: number) => `ほか ${count} 件`,
    postFrame: (service: string) => `${service} の投稿`,
    cites: 'このスライドが引用しているスライド',
    manage: {
      title: (deck: string) => `${deck} への反応`,
      back: 'デッキに戻る',
      results: {
        added: '投稿を追加しました。',
        exists: 'その投稿はすでに追加されています。',
        invalid:
          'X または Bluesky の投稿の URL と、ページ番号を確認してください。',
        unresolved: 'Bluesky のアカウントが見つかりませんでした。',
        removed: '投稿を外しました。',
        search_failed:
          'Bluesky を検索できませんでした。時間をおいて試してください。',
        full: 'これ以上は追加できません。不要な投稿を外してください。',
      },
      collected: (count: number) =>
        `Bluesky から ${count} 件の投稿を追加しました。`,
      citedByHeading: '引用されたページ',
      citedByNone:
        'まだ引用されていません。他のスライドがこのスライドの共有 URL にリンクして公開されると、ここに表示されます。',
      postsHeading: '表示している投稿',
      postsNone: 'まだ投稿はありません。',
      remove: '外す',
      sources: { pasted: '貼り付け', collected: '検索' },
      addHeading: '投稿を追加する',
      url: 'X または Bluesky の投稿の URL',
      pageField: 'ページ番号（空欄ならスライド全体）',
      add: '追加する',
      collectHeading: 'Bluesky から集める',
      collectNote: (query: string) =>
        `共有 URL（${query}）を含む投稿を探して追加します。ハッシュタグなど別の言葉で探すこともできます。追加した投稿は読者に表示されるので、関係のないものは外してください。`,
      query: '探す言葉（空欄なら共有 URL）',
      collect: '集める',
      notPublic: '一般公開すると、共有 URL を含む投稿を探せるようになります。',
    },
  },
  en: {
    heading: 'Reactions to these slides',
    timeline: (count: number) => `Reactions ${count}`,
    empty: 'No reactions yet. Posts about these slides show here.',
    whole: 'The whole deck',
    page: (page: number) => `Page ${page}`,
    citedBy: 'Slides citing these slides',
    more: (count: number) => `${count} more`,
    postFrame: (service: string) => `Post on ${service}`,
    cites: 'Slides these slides cite',
    manage: {
      title: (deck: string) => `Reactions to ${deck}`,
      back: 'Back to the deck',
      results: {
        added: 'The post was added.',
        exists: 'That post is already added.',
        invalid: 'Check the URL of the X or Bluesky post, and the page number.',
        unresolved: 'The Bluesky account was not found.',
        removed: 'The post was removed.',
        search_failed: 'Could not search Bluesky. Try again later.',
        full: 'No more posts can be added. Remove ones you do not need.',
      },
      collected: (count: number) =>
        `Added ${count} ${count === 1 ? 'post' : 'posts'} from Bluesky.`,
      citedByHeading: 'Pages cited',
      citedByNone:
        'Not cited yet. When other slides link to the share link of these slides and are published, they show here.',
      postsHeading: 'Posts shown',
      postsNone: 'No posts yet.',
      remove: 'Remove',
      sources: { pasted: 'Pasted', collected: 'Search' },
      addHeading: 'Add a post',
      url: 'URL of a post on X or Bluesky',
      pageField: 'Page number (empty for the whole deck)',
      add: 'Add',
      collectHeading: 'Collect from Bluesky',
      collectNote: (query: string) =>
        `Finds posts containing the share link (${query}) and adds them. You can search for other words, such as a hashtag. Added posts are shown to readers, so remove unrelated ones.`,
      query: 'Search words (empty for the share link)',
      collect: 'Collect',
      notPublic:
        'Once these slides are public, you can find posts containing their share link.',
    },
  },
})

/** Stored names are checked again before they become a link. */
export function deckHref(link: Readonly<{ handle: string; slug: string }>) {
  const handle = handleSchema.safeParse(link.handle)
  const slug = deckIdSchema.safeParse(link.slug)
  if (!handle.success || !slug.success) return null
  return sharePath(handle.data, slug.data)
}

const deckName = (link: DeckLink) => link.title ?? link.slug

/** The embed origins a view's posts need the viewer to frame. */
export const embedOriginsOf = (view: ReactionsView): string[] => [
  ...new Set(view.timeline.map((item) => EMBED_ORIGINS[item.post.service])),
]

/**
 * A deck running in a frame sandboxed like the viewer's own deck. The
 * viewer's script draws it at a full slide's size and scales it down, so a
 * deck laid out for a large screen keeps its layout when shown small.
 */
export const deckFrame = (deck: CitedView, href: string) => {
  const name = deck.title ?? deck.slug
  return html`<div class="mini" data-mini>
      <iframe
        data-deck
        src="${deck.contentUrl}"
        title="${name}"
        loading="lazy"
        sandbox="allow-scripts allow-same-origin"
        referrerpolicy="no-referrer"
      ></iframe>
    </div>
    <p>
      <a href="${href}">${name}</a>
      <small>@${deck.handle}</small>
    </p>`
}

/**
 * A post in its service's own embed page. The frame can run its script and
 * open the post in a new tab, but cannot move or script the viewer. The
 * embed links to the post itself, so the viewer adds no link of its own.
 */
const postEntry = (item: TimelineItem, lang: Lang) => {
  const t = text[lang]
  const service = services[item.post.service]
  return html`<li class="entry">
    <iframe
      class="embed"
      data-embed
      src="${embedUrl(item.post)}"
      title="${t.postFrame(service)}"
      loading="lazy"
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerpolicy="no-referrer"
    ></iframe>
  </li>`
}

/** The timeline of posts, shown beside the deck. */
export function timelinePanel(view: ReactionsView, lang: Lang) {
  const t = text[lang]
  return html`<aside id="reactions" class="timeline" aria-label="${t.heading}">
    <h2>${t.timeline(view.timeline.length)}</h2>
    ${
      view.timeline.length
        ? html`<ol>
            ${view.timeline.map((item) => postEntry(item, lang))}
          </ol>`
        : html`<p class="empty">${t.empty}</p>`
    }
  </aside>`
}

/** The origins of the citing and cited decks, which the viewer frames. */
export const deckOriginsOf = (view: ReactionsView): string[] => [
  ...new Set(
    [...view.citedBy.shown, ...view.cites.shown].map(
      (deck) => new URL(deck.contentUrl).origin,
    ),
  ),
]

const deckList = (
  heading: string,
  decks: Shortened<CitedView>,
  lang: Lang,
): Markup =>
  decks.shown.length
    ? html`<section class="cites">
        <h2>${heading}</h2>
        <ul>
          ${decks.shown.map((deck) => {
            const href = deckHref(deck)
            return href ? html`<li>${deckFrame(deck, href)}</li>` : ''
          })}
        </ul>
        ${
          decks.more > 0
            ? html`<p class="more">${text[lang].more(decks.more)}</p>`
            : ''
        }
      </section>`
    : ''

/**
 * The public decks on either side of a citation, shown under the deck: those
 * that link to it, then those it links to. Each runs in its own frame, so
 * each side shows its latest few.
 */
export const citationSections = (view: ReactionsView, lang: Lang) =>
  html`${deckList(text[lang].citedBy, view.citedBy, lang)}
  ${deckList(text[lang].cites, view.cites, lang)}`

/** Outcomes of a reactions form, shown once after the redirect. */
const manageResults = [
  'added',
  'exists',
  'invalid',
  'unresolved',
  'removed',
  'search_failed',
  'full',
] as const
export type ManageResult =
  | Readonly<{ kind: (typeof manageResults)[number] }>
  | Readonly<{ kind: 'collected'; count: number }>

export function parseManageResult(
  result: string | undefined,
  count: string | undefined,
): ManageResult | null {
  if (
    result === 'collected' &&
    count !== undefined &&
    /^[0-9]{1,3}$/.test(count)
  )
    return { kind: 'collected', count: Number(count) }
  const kind = manageResults.find((known) => known === result)
  return kind ? { kind } : null
}

export const manageTitle = (deck: string, lang: Lang) =>
  text[lang].manage.title(deck)

/** The owner's page for the reactions of one deck. */
export function manageBody(
  view: Readonly<{
    deck: string
    /** The share URL without its scheme, while the deck is public. */
    defaultQuery: string | null
    citedBy: readonly DeckLink[]
    posts: readonly StoredPost[]
    result: ManageResult | null
  }>,
  lang: Lang,
) {
  const t = text[lang]
  const m = t.manage
  const base = `/decks/${view.deck}/reactions`
  const pageLabel = (page: number) => (page > 0 ? t.page(page) : t.whole)
  return html`<p><a href="/decks/${view.deck}">${m.back}</a></p>
    <h1>${m.title(view.deck)}</h1>
    ${
      view.result
        ? html`<p role="status">
            ${
              view.result.kind === 'collected'
                ? m.collected(view.result.count)
                : m.results[view.result.kind]
            }
          </p>`
        : ''
    }
    <h2>${m.citedByHeading}</h2>
    ${
      view.citedBy.length
        ? html`<ul>
            ${view.citedBy.map((link) => {
              const href = deckHref(link)
              return href
                ? html`<li>
                    ${pageLabel(link.page)}:
                    <a href="${href}">${deckName(link)}</a>
                    <small>@${link.handle}</small>
                  </li>`
                : ''
            })}
          </ul>`
        : html`<p>${m.citedByNone}</p>`
    }
    <h2>${m.addHeading}</h2>
    <form method="post" action="${base}">
      <p>
        <label
          >${m.url}<br /><input
            name="url"
            type="url"
            required
            style="width: 32em; max-width: 100%; box-sizing: border-box"
        /></label>
      </p>
      <p>
        <label
          >${m.pageField}<br /><input
            name="page"
            inputmode="numeric"
            pattern="[0-9]{1,4}"
            size="6"
        /></label>
      </p>
      <button>${m.add}</button>
    </form>
    <h2>${m.collectHeading}</h2>
    ${
      view.defaultQuery
        ? html`<p>${m.collectNote(view.defaultQuery)}</p>
            <form method="post" action="${base}/collect">
              <p>
                <label
                  >${m.query}<br /><input
                    name="query"
                    maxlength="200"
                    style="width: 32em; max-width: 100%; box-sizing: border-box"
                /></label>
              </p>
              <button>${m.collect}</button>
            </form>`
        : html`<p>${m.notPublic}</p>`
    }
    <h2>${m.postsHeading}</h2>
    ${
      view.posts.length
        ? html`<table>
            ${view.posts.map(
              (item) =>
                html`<tr>
                  <td>${pageLabel(item.page)}</td>
                  <td>
                    <a
                      href="${postUrl(item.post)}"
                      target="_blank"
                      rel="noopener noreferrer"
                      >${postUrl(item.post)}</a
                    >
                  </td>
                  <td>${m.sources[item.source]}</td>
                  <td>
                    <form
                      method="post"
                      action="${base}/${item.id}/remove"
                      style="margin: 0"
                    >
                      <button>${m.remove}</button>
                    </form>
                  </td>
                </tr>`,
            )}
          </table>`
        : html`<p>${m.postsNone}</p>`
    }`
}

/** The link to the reactions page, shown on the deck's page. */
export const manageLink = (deck: string, lang: Lang) =>
  html`<p><a href="/decks/${deck}/reactions">${text[lang].heading}</a></p>`
