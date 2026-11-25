import type { Handle } from '../share/handle'
import type { Lang } from '../site/i18n'

/**
 * The places on a community's page that the work on following communities
 * fills (docs/features/f31-community-follow.md): "follow" in its head, and
 * the list its followers tab opens. Nothing yet.
 */
export const communityFollowFrame = (
  _input: Readonly<{
    communityId: number
    handle: Handle
    viewer: string | null
  }>,
  _lang: Lang,
) => ''

export const communityFollowersFrame = (_handle: Handle, _lang: Lang) => ''
