/** The longest reason the operator may give for taking a picture down. */
export const REMOVAL_REASON_MAX = 500

export type RemovalReasonCheck =
  | Readonly<{ kind: 'ok'; reason: string }>
  | Readonly<{ kind: 'invalid' }>

/**
 * The reason for taking a picture down: text, with its white space at the
 * ends taken off, of 1 to 500 characters. It is kept in the operator's
 * record, so it must say something.
 */
export function checkRemovalReason(input: unknown): RemovalReasonCheck {
  const reason = typeof input === 'string' ? input.trim() : ''
  if (reason === '' || Array.from(reason).length > REMOVAL_REASON_MAX)
    return { kind: 'invalid' }
  return { kind: 'ok', reason }
}
