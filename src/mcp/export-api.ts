import { readAccountInfo } from '../exports/account-export-store'
import { exportAccountView } from './export-views'
import { toolError, toolResult, type ToolResult } from './tools'

/** What the export tools need of the request they serve. */
type Session = Readonly<{ env: Env; ownerUserId: string }>

const now = () => Math.floor(Date.now() / 1000)

/**
 * The author's account file and the list of their slides. The same reader
 * as the settings' export: every query starts from the author's own rows,
 * and the author is the one the connection's token names.
 */
export async function exportAccount({
  env,
  ownerUserId,
}: Session): Promise<ToolResult> {
  const info = await readAccountInfo(env.DB, {
    userId: ownerUserId,
    origin: env.PUBLIC_ORIGIN,
    now: now(),
  })
  return info
    ? toolResult(exportAccountView(info))
    : toolError('unknown_account')
}
