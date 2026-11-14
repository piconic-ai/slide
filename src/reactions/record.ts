import { citationsOf, mergeCitations } from './citation'
import { listHtmlObjects, readDeploymentDeck, saveCitations } from './store'

/** How much of each HTML file is read for links. */
export const LINK_SCAN_BYTES = 512 * 1024

/**
 * Reads the links a deployment's HTML files make to share URLs and keeps
 * them. Citations only add to what readers see, so a storage error leaves
 * them out instead of failing the upload.
 */
export async function recordCitations(env: Env, deploymentId: string) {
  try {
    const keys = await listHtmlObjects(env.DB, deploymentId)
    const perFile = await Promise.all(
      keys.map(async (key) => {
        const object = await env.UPLOADS.get(key, {
          range: { offset: 0, length: LINK_SCAN_BYTES },
        })
        return object ? citationsOf(await object.text(), env.PUBLIC_ORIGIN) : []
      }),
    )
    const found = mergeCitations(
      perFile,
      await readDeploymentDeck(env.DB, deploymentId),
    )
    await saveCitations(env.DB, deploymentId, found)
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'citations_unrecorded',
        deploymentId,
        name: error instanceof Error ? error.name : 'unknown',
      }),
    )
  }
}
