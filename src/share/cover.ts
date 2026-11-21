import { coverShotPath, MAX_SHOT_PAGE, pageShotPath } from '../covers/shot'
import { deploymentOrigin } from '../preview/origin'

/**
 * The path, or for a file of the deck the URL, of a deployment's cover: the
 * image its deck names, or else the first slide as the service takes it.
 */
export const coverUrl = (
  contentBase: URL,
  deploymentId: string,
  coverPath: string | null,
) =>
  coverPath === null
    ? coverShotPath(deploymentId)
    : `${deploymentOrigin(contentBase, deploymentId)}/${coverPath
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`

/**
 * The path or URL of the image a share URL offers to services that preview
 * links. A URL that names a page offers that page as the service takes it,
 * whatever cover the deck names, when the deck pages by number and the page
 * is one the service takes. Every other URL offers the cover, as the URL
 * without a page always does.
 */
export const previewImageUrl = (
  contentBase: URL,
  shared: Readonly<{
    id: string
    coverPath: string | null
    loadsPageScript: boolean
  }>,
  page: number | null,
) =>
  page !== null && shared.loadsPageScript && page <= MAX_SHOT_PAGE
    ? pageShotPath(shared.id, page)
    : coverUrl(contentBase, shared.id, shared.coverPath)
