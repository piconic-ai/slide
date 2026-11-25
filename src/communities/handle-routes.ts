import type { Context } from 'hono'
import type { SharePath } from '../share/path'

/** A share path that names a handle: not a redirect, and readable. */
export type HandlePath = Exclude<SharePath, { kind: 'redirect' | 'invalid' }>

/**
 * What `/@handle` and the paths under it show when a community holds the
 * handle (docs/dev/f30-handles.md). The community's pages are the third
 * scope's work C; until they exist, every such path is the unavailable page.
 */
export async function showCommunity<E extends { Bindings: Env }>(
  _c: Context<E>,
  _input: Readonly<{ communityId: string; path: HandlePath }>,
  unavailable: () => Response | Promise<Response>,
): Promise<Response> {
  return unavailable()
}
