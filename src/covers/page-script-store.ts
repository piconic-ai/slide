import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { loadsPageScript } from '../../scripts/page-script.mjs'
import { pageScriptDeployments, uploadFiles } from '../db/schema'

/**
 * Notes a deployment whose index.html loads the page script, which is what
 * lets its pages be taken as images. The tag may sit anywhere in the file,
 * so all of it is read. The note only adds to what link previews show, so a
 * storage error leaves the deployment without one, and with its cover on
 * every page's URL, instead of failing the upload.
 */
export async function recordPageScript(
  database: D1Database,
  bucket: R2Bucket,
  deploymentId: string,
) {
  try {
    const db = drizzle(database)
    const entry = await db
      .select({ key: uploadFiles.object_key })
      .from(uploadFiles)
      .where(
        and(
          eq(uploadFiles.deployment_id, deploymentId),
          eq(uploadFiles.path, 'index.html'),
        ),
      )
      .get()
    const object = entry?.key ? await bucket.get(entry.key) : null
    if (!object || !loadsPageScript(await object.text())) return
    await db
      .insert(pageScriptDeployments)
      .values({ deployment_id: deploymentId })
      .onConflictDoNothing()
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'page_script_unrecorded',
        deploymentId,
        name: error instanceof Error ? error.name : 'unknown',
      }),
    )
  }
}
