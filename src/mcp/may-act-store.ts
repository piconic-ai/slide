import { isInvitedUser } from '../auth/invites-store'
import { readSuspension } from '../publication/suspension-store'

/**
 * Whether the owner may still act: a registered author who is not
 * suspended. Asked on every tool call and every fetch of a file, so
 * removing or suspending an author stops the agents they connected before
 * and the addresses those agents were given.
 */
export async function mayAct(
  database: D1Database,
  ownerUserId: string,
): Promise<boolean> {
  return (
    (await isInvitedUser(database, ownerUserId)) &&
    (await readSuspension(database, ownerUserId)) === null
  )
}
