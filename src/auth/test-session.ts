/** Seeds a valid server session for store-level tests that do not issue cookies. */
export async function seedOwnerSession(
  database: D1Database,
  githubId: string,
): Promise<string> {
  const userId = `user-${githubId}`
  const sessionId = `session-${githubId}`
  const now = Date.now()
  await database.batch([
    database
      .prepare(
        'INSERT INTO auth_user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?) ON CONFLICT DO NOTHING',
      )
      .bind(userId, githubId, `${githubId}@fixture.invalid`, now, now),
    database
      .prepare(
        "INSERT INTO auth_account (id, account_id, provider_id, user_id, created_at, updated_at) VALUES (?, ?, 'github', ?, ?, ?) ON CONFLICT DO NOTHING",
      )
      .bind(`account-${githubId}`, githubId, userId, now, now),
    database
      .prepare(
        'INSERT INTO auth_session (id, token, user_id, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
      )
      .bind(sessionId, `token-${githubId}`, userId, now + 43200000, now, now),
  ])
  return sessionId
}
