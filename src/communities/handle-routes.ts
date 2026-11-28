import type { Context } from 'hono'
import { currentOwner } from '../auth/owner-middleware'
import { homePagePolicy, renderPage } from '../decks/pages'
import { contentBaseOf } from '../preview/config'
import type { SharePath } from '../share/path'
import { alternateLinks } from '../site/i18n'
import { langOf } from '../site/lang'
import {
  communityPageBody,
  communityPageTitle,
  communityTabPath,
  type CommunityTab,
  type CommunityTabView,
} from './community-page'
import {
  PEOPLE_PER_PAGE,
  parsePeoplePage,
  peopleReaderOf,
} from '../follows/people'
import {
  communityFollowersFrame,
  communityFollowFrame,
  communityFollowState,
} from './follow-frames'
import { showCommunityEdit } from './edit-routes'
import { isFollowingCommunity } from './follow-store'
import {
  countCommunityFollowers,
  listCommunityFollowers,
} from './followers-store'
import {
  findCommunity,
  isCommunityAdmin,
  readCommunityTalks,
} from './page-store'

/** A share path that names a handle: not a redirect, and readable. */
export type HandlePath = Exclude<SharePath, { kind: 'redirect' | 'invalid' }>

/**
 * The part of a community's page a path under its handle opens: the links
 * at `/@handle`, the slides at `/@handle/slides`, the followers at
 * `/@handle/followers`; `edit` is the editing page. Any other path is not
 * a community's.
 */
export type CommunityPath =
  | Readonly<{ kind: 'tab'; tab: CommunityTab }>
  | Readonly<{ kind: 'edit' }>

export function communityPathOf(path: HandlePath): CommunityPath | null {
  if (path.kind === 'profile') return { kind: 'tab', tab: 'links' }
  if (path.kind === 'people' && path.list === 'followers')
    return { kind: 'tab', tab: 'followers' }
  if (path.kind === 'deck' && path.slug === 'slides')
    return { kind: 'tab', tab: 'slides' }
  if (path.kind === 'deck' && path.slug === 'edit') return { kind: 'edit' }
  return null
}

/** The id of a community as `handles` keeps it, read as its number. */
const communityIdOf = (id: string) =>
  /^[1-9][0-9]{0,15}$/u.test(id) && Number.isSafeInteger(Number(id))
    ? Number(id)
    : null

/**
 * What `/@handle` and the paths under it show when a community holds the
 * handle (docs/dev/f30-handles.md): the community's page and its tabs.
 * The talks of people the viewer muted or blocked are left out of the lists
 * and the counts (F30-AC38).
 */
export async function showCommunity<E extends { Bindings: Env }>(
  c: Context<E>,
  input: Readonly<{ communityId: string; path: HandlePath }>,
  unavailable: () => Response | Promise<Response>,
): Promise<Response> {
  const communityId = communityIdOf(input.communityId)
  const at = communityPathOf(input.path)
  if (communityId === null || at === null) return unavailable()
  if (at.kind === 'edit') return showCommunityEdit(c, communityId, unavailable)
  const url = new URL(c.req.url)
  const page =
    at.tab === 'followers' ? parsePeoplePage(url.searchParams.get('page')) : 1
  if (page === null) return unavailable()
  const database = c.env.DB
  const community = await findCommunity(database, communityId)
  if (!community) return unavailable()
  const viewer = (await currentOwner(c))?.userId ?? null
  const followersOf = { communityId, viewer }
  const [talks, followers, admin, following, people] = await Promise.all([
    readCommunityTalks(database, communityId, viewer),
    countCommunityFollowers(database, followersOf),
    viewer === null ? false : isCommunityAdmin(database, communityId, viewer),
    viewer === null
      ? false
      : isFollowingCommunity(database, { userId: viewer, communityId }),
    at.tab === 'followers'
      ? listCommunityFollowers(database, {
          ...followersOf,
          limit: PEOPLE_PER_PAGE,
          offset: (page - 1) * PEOPLE_PER_PAGE,
        })
      : [],
  ])
  const lang = langOf(c)
  const view: CommunityTabView =
    at.tab === 'links'
      ? { kind: 'links', links: talks.events }
      : at.tab === 'slides'
        ? { kind: 'slides', slides: talks.slides }
        : {
            kind: 'followers',
            list: communityFollowersFrame(
              {
                handle: community.handle,
                people,
                page,
                total: followers,
                reader: peopleReaderOf(viewer, viewer),
              },
              lang,
            ),
          }
  const contentBase = contentBaseOf(c.env)
  c.header('Link', alternateLinks(c.env.PUBLIC_ORIGIN, new URL(c.req.url)))
  return renderPage(
    c,
    communityPageTitle(community),
    communityPageBody(
      {
        community,
        reader: {
          admin,
          follow: communityFollowFrame(
            {
              state: communityFollowState(viewer, following),
              handle: community.handle,
              name: community.name,
              back: communityTabPath(community.handle, at.tab),
            },
            lang,
          ),
        },
        counts: {
          links: talks.events.length,
          slides: talks.slides.length,
          followers,
        },
        view,
        contentBase,
      },
      lang,
    ),
    200,
    homePagePolicy(contentBase),
  )
}
