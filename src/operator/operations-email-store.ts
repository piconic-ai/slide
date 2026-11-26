import { EmailCryptoError } from '../db/email-cipher'
import { emailCryptoOf } from '../db/email-settings'
import { assertKeysFitData } from '../db/email-store'
import { countEmailRows } from '../db/email-rewrite-store'
import { keyVersions } from '../db/email-cipher'
import type { EmailFrameView } from './operations-email-frame'

/**
 * What the "メールアドレスの暗号化" frame shows: whether the keys are set,
 * whether they fit the stored rows, and the counts of rows by state.
 */
export async function readEmailFrame(env: Env): Promise<EmailFrameView> {
  const config = emailCryptoOf(env)
  if (config.kind === 'off') return { kind: 'not_configured' }
  if (config.kind === 'invalid')
    return { kind: 'invalid', problems: config.problems }
  try {
    await assertKeysFitData(env.DB, config)
  } catch (error) {
    if (error instanceof EmailCryptoError) return { kind: 'mismatch' }
    throw error
  }
  return {
    kind: 'ready',
    versions: keyVersions(config),
    current: config.current,
    counts: await countEmailRows(env.DB, config),
  }
}
