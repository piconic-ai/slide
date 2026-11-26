import { EmailCryptoError } from '../db/email-cipher'
import { emailCryptoOf } from '../db/email-settings'
import { readAccountInfo } from '../exports/account-export-store'
import { exportAccountView } from './export-views'
import { toolError, toolResult, type ToolResult } from './tools'

/** What the export tools need of the request they serve. */
type Session = Readonly<{ env: Env; ownerUserId: string }>

const now = () => Math.floor(Date.now() / 1000)

/**
 * The author's account file and the list of their slides. The same reader
 * as the settings' export: every query starts from the author's own rows,
 * and the author is the one the connection's token names. The address in
 * the file is read through the same keys as everywhere (F41), so a row the
 * service sealed comes back in the clear for its own author.
 *
 * Keys that are set but unusable cannot open a sealed address. The error
 * carries a code only (never an address or a key), and the answer is a
 * refusal with a fixed sentence, so the agent can tell the author.
 */
export async function exportAccount({
  env,
  ownerUserId,
}: Session): Promise<ToolResult> {
  try {
    const info = await readAccountInfo(env.DB, {
      userId: ownerUserId,
      origin: env.PUBLIC_ORIGIN,
      now: now(),
      email: emailCryptoOf(env),
    })
    return info
      ? toolResult(exportAccountView(info))
      : toolError('unknown_account')
  } catch (error) {
    if (error instanceof EmailCryptoError) return toolError('email_unavailable')
    throw error
  }
}
