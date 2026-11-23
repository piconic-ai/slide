import { contentBaseOf } from '../preview/config'
import type { LinkInput } from './link'
import { addLink, readAddRoom, type AddResult } from './store'
import { fetchLinkTitle } from './title-client'

/** Where a stored title came from. */
export type TitleSource = 'given' | 'fetched' | 'none'

export type AddedLink =
  | Readonly<{ result: 'added'; titleSource: TitleSource }>
  | Readonly<{ result: Exclude<AddResult, 'added'> }>

/** The host names of the service itself: no lookup is sent to them. */
export const ownHostsOf = (env: Env): readonly string[] => [
  new URL(env.PUBLIC_ORIGIN).hostname,
  ...(contentBaseOf(env) ? [contentBaseOf(env)?.hostname ?? ''] : []),
]

/**
 * How many lookups one author may start in a minute, whichever slides they
 * are for. It is counted in PAGE_SHOT_RATE_LIMITER (6 a minute for each key,
 * see wrangler.jsonc), under a key of its own, so no binding is added.
 */
export const TITLE_LOOKUPS_PER_MINUTE = 6

/** The key one author's lookups are counted under. */
export const titleLookupKey = (ownerUserId: string) =>
  `link-title:${ownerUserId}`

/**
 * Whether a lookup is worth making and allowed now: the deck can take the
 * link (a full, foreign or deleted deck is not asked about) and the author is
 * within their budget of lookups. Anything else adds the link with no title.
 */
async function mayLookUp(
  env: Env,
  input: Readonly<{ deckId: string; ownerUserId: string }>,
): Promise<boolean> {
  if ((await readAddRoom(env.DB, input)) !== 'room') return false
  const { success } = await env.PAGE_SHOT_RATE_LIMITER.limit({
    key: titleLookupKey(input.ownerUserId),
  })
  return success
}

/**
 * Adds a link to the owner's deck. A link with no title gets one lookup of
 * the page it leads to, made here before the row is written; a lookup that
 * finds nothing leaves the link without a title, and the add succeeds all the
 * same. The limit and the owner are checked by the insert, as ever.
 */
export async function addLinkWithTitle(
  env: Env,
  input: Readonly<{
    deckId: string
    ownerUserId: string
    link: LinkInput
    now: number
    fetcher?: typeof fetch
  }>,
): Promise<AddedLink> {
  const { link, fetcher } = input
  const fetched =
    link.title === null && (await mayLookUp(env, input))
      ? await fetchLinkTitle(link.url, { ownHosts: ownHostsOf(env), fetcher })
      : null
  const title = link.title ?? fetched
  const result = await addLink(env.DB, {
    deckId: input.deckId,
    ownerUserId: input.ownerUserId,
    link: { ...link, title },
    now: input.now,
  })
  if (result !== 'added') return { result }
  return {
    result,
    titleSource:
      link.title !== null ? 'given' : fetched !== null ? 'fetched' : 'none',
  }
}
