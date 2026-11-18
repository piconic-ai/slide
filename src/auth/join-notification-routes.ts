import { notifyJoined } from '../notifications/store'
import { readHandle } from '../share/store'
import { fetchFollowerIds } from './github-client'

function logUnrecorded(error: unknown) {
  console.error(
    JSON.stringify({
      event: 'join_notifications_unrecorded',
      name: error instanceof Error ? error.name : 'unknown',
    }),
  )
}

export async function hadNoAccount(database: D1Database, userId: string) {
  // Only a successful read of an absent account can announce a join.
  return (await readHandle(database, userId).catch(logUnrecorded)) === null
}

export async function recordJoinNotifications(
  database: D1Database,
  actorUserId: string,
  login: string,
  token: string,
  now: number,
) {
  try {
    if (!(await readHandle(database, actorUserId))) return
    const recipientUserIds: string[] = []
    try {
      const pages = fetchFollowerIds(token, login, AbortSignal.timeout(3000))
      for await (const page of pages) recipientUserIds.push(...page)
    } finally {
      // A failed page still leaves its predecessors eligible for delivery.
      await notifyJoined(database, { actorUserId, recipientUserIds, now })
    }
  } catch (error) {
    logUnrecorded(error)
  }
}
