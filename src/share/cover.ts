import { coverShotPath } from '../covers/shot'
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
