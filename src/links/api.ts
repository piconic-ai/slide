import { contentBaseOf } from '../preview/config'
import type { LinkInput } from './link'
import { addLink, type AddResult } from './store'
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
    link.title === null
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
