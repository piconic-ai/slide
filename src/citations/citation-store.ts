import { citationsOf, LINK_SCAN_BYTES, mergeCitations } from './citation'
import { listHtmlObjects, readDeploymentDeck, saveCitations } from './store'

export { LINK_SCAN_BYTES }

/**
 * Reads the links a deployment's HTML files make to share URLs and keeps
 * them. Citations only add to what readers see, so a storage error leaves
 * them out instead of failing the upload. Answers how many were kept.
 */
export async function recordCitations(
  env: Env,
  deploymentId: string,
): Promise<number> {
  try {
    const keys = await listHtmlObjects(env.DB, deploymentId)
    const perFile = await Promise.all(
      keys.map(async (key) => {
        const object = await env.UPLOADS.get(key, {
          range: { offset: 0, length: LINK_SCAN_BYTES },
        })
        if (!object) return []
        // Only the head of a longer file was read.
        const cut = object.size > LINK_SCAN_BYTES
        return citationsOf(await object.text(), env.PUBLIC_ORIGIN, { cut })
      }),
    )
    const found = mergeCitations(
      perFile,
      await readDeploymentDeck(env.DB, deploymentId),
    )
    await saveCitations(env.DB, deploymentId, found)
    return found.length
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'citations_unrecorded',
        deploymentId,
        name: error instanceof Error ? error.name : 'unknown',
      }),
    )
    return 0
  }
}
