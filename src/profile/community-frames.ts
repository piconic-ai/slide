import { html } from 'hono/html'
import { adminBadge, adminBadgeStyle } from '../communities/admin-badge'
import type { CommunityTalk } from '../communities/community'
import { logoOf } from '../communities/logo'
import { communityStyle } from '../communities/community-style'
import { communityFollowForm } from '../communities/follow-frames'
import type { FollowState } from '../follows/pages'
import { neighbourPages, type PeopleReader } from '../follows/people'
import { coverUrl } from '../share/cover'
import { dayFormats } from '../share/dates'
import type { Handle } from '../share/handle'
import { communitiesPath, profilePath, sharePath } from '../share/path'
import { deckCard } from '../site/deck-card'
import { messages, type Lang } from '../site/i18n'
import { loginPrompt } from '../site/login-prompt'
import type { ProfileCommunity } from './communities-store'

/**
 * The places of a profile's communities: its tab and the list the tab
 * opens. They are frames of their own, so that the work on following
 * communities fills them without touching the rest of the profile. The
 * tab's place among the others is set by `profileTabs` in pages.ts.
 */
const text = messages({
  ja: {
    communities: 'コミュニティ',
    none: 'フォロー・管理しているコミュニティは、まだありません。',
    pastEnd: 'このページには、コミュニティがありません。',
    pages: '一覧のページ',
    previous: '前の 50 件',
    next: '次の 50 件',
    talksOf: (name: string) => `${name} の最近のスライド`,
  },
  en: {
    communities: 'Communities',
    none: 'No communities followed or run yet.',
    pastEnd: 'No communities on this page.',
    pages: 'Pages of the list',
    previous: 'Previous 50',
    next: 'Next 50',
    talksOf: (name: string) => `Recent slides of ${name}`,
  },
})

/** The name of the list of communities, for its tab and its page's title. */
export const communitiesListName = (lang: Lang) => text[lang].communities

/** The "communities" tab, with its count. */
export const communitiesTab = (
  handle: Handle,
  count: number,
  current: boolean,
  lang: Lang,
) =>
  html`<a
    href="${communitiesPath(handle)}"
    ${current ? html`aria-current="page"` : ''}
    >${text[lang].communities} <span class="count">${count}</span></a
  >`

/** Who reads the tab, as far as its buttons go (src/follows/people.ts). */
export type CommunitiesReader = PeopleReader

const rowFollowState = (
  community: ProfileCommunity,
  reader: CommunitiesReader,
): FollowState => {
  if (reader.kind === 'signed-out') return 'signed-out'
  if (reader.kind === 'stopped') return 'none'
  return community.followedByViewer ? 'following' : 'can-follow'
}

const talkCard = (talk: CommunityTalk, contentBase: URL | null, lang: Lang) => {
  const at = new Date(talk.publishedAt * 1000)
  return deckCard(
    {
      name: talk.title ?? talk.slug,
      href: sharePath(talk.handle, talk.slug),
      coverUrl: contentBase
        ? coverUrl(contentBase, talk.deploymentId, talk.coverPath)
        : null,
    },
    html`<a href="${profilePath(talk.handle)}">@${talk.handle}</a> ·
      <time datetime="${at.toISOString()}"
        >${dayFormats[lang].format(at)}</time
      >`,
  )
}

/**
 * One community the author follows or runs: its logo, its name to its page, the key
 * when the author runs it (F30-AC34), the reader's own "follow", and its
 * newest slides (F31-AC8). No count of followers or events.
 */
function communityRow(
  community: ProfileCommunity,
  list: CommunitiesList,
  lang: Lang,
) {
  const talks = list.talks.get(community.id) ?? []
  return html`<li class="followed-community">
    <div class="followed-community-head">
      ${logoOf(community, 48)}
      <span class="followed-community-name"
        ><a href="${profilePath(community.handle)}">${community.name}</a>${
          community.admin ? html` ${adminBadge(lang)}` : ''
        }</span
      >
      ${communityFollowForm(
        rowFollowState(community, list.reader),
        community,
        communitiesPath(list.handle),
        lang,
      )}
    </div>
    ${
      talks.length > 0
        ? html`<ul
            class="deck-grid deck-grid-4"
            aria-label="${text[lang].talksOf(community.name)}"
          >
            ${talks.map((talk) => talkCard(talk, list.contentBase, lang))}
          </ul>`
        : ''
    }
  </li>`
}

/** What the communities tab lists, one page of it. */
export type CommunitiesList = Readonly<{
  handle: Handle
  communities: readonly ProfileCommunity[]
  /** The newest slides of each community, by its number. */
  talks: ReadonlyMap<number, readonly CommunityTalk[]>
  page: number
  /** How many communities the whole list has, over all its pages. */
  total: number
  reader: CommunitiesReader
  contentBase: URL | null
}>

const style = html`<style>
  .followed-community-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .followed-community {
    padding: 20px 0;
    border-bottom: 1px solid var(--border);
  }
  .followed-community-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }
  .followed-community-name {
    flex: 1;
    min-width: 0;
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .followed-community-name a {
    color: var(--foreground);
  }
</style>`

/**
 * What `/@handle/communities` shows under the tabs: the communities the
 * author follows or runs, each once, the newest follow or admin first, one
 * under another (F31-AC8), with the way to the pages before and after.
 * Anyone may read it (F31-AC9).
 */
export function communitiesListFrame(list: CommunitiesList, lang: Lang) {
  const t = text[lang]
  const { previous, next } = neighbourPages(list.page, list.total)
  const link = (page: number | null, rel: 'prev' | 'next', label: string) =>
    page === null
      ? ''
      : html`<a rel="${rel}" href="${communitiesPath(list.handle)}?page=${page}"
          >${label}</a
        >`
  return html`${communityStyle}${adminBadgeStyle}${style}${
      list.reader.kind === 'signed-out'
        ? loginPrompt('follow-community', communitiesPath(list.handle), lang)
        : ''
    }
    <section class="followed-communities">
      ${
        list.communities.length > 0
          ? html`<ul class="followed-community-list">
              ${list.communities.map((community) =>
                communityRow(community, list, lang),
              )}
            </ul>`
          : html`<p class="empty">${list.total === 0 ? t.none : t.pastEnd}</p>`
      }
      ${
        previous === null && next === null
          ? ''
          : html`<nav class="people-pages" aria-label="${t.pages}">
              ${link(previous, 'prev', t.previous)}
              ${link(next, 'next', t.next)}
            </nav>`
      }
    </section>`
}
