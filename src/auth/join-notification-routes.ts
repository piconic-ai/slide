import { listJoinAudience, notifyJoined } from '../notifications/store'
import { readHandle } from '../share/store'
import { fetchFollows } from './github-client'

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
    const audience = await listJoinAudience(database, actorUserId, 50)
    const signal = AbortSignal.timeout(3000)
    const followers = await Promise.all(
      audience.map(async (person) => {
        const follows = await fetchFollows(
          token,
          person.login,
          login,
          signal,
        ).catch(logUnrecorded)
        return follows ? [person.userId] : []
      }),
    )
    await notifyJoined(database, {
      actorUserId,
      recipientUserIds: followers.flat(),
      now,
    })
  } catch (error) {
    logUnrecorded(error)
  }
}
