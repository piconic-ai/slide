import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from '../db/test-migrations'
import { parseUploadLimits } from './limits'
import { parseInventoryStructure } from './inventory'
import {
  insertRejectedStart,
  insertSessionWithinQuota,
  readQuotaUsage,
  type NewSession,
} from './start-store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const now = Math.floor(Date.now() / 1000)
const limits = parseUploadLimits({
  authorBytes: 100,
  deploymentBytes: 100,
  fileBytes: 100,
  startsPerDay: 2,
  refusalsPerDay: 1,
})

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await db.batch([
    db.prepare('DELETE FROM upload_files'),
    db.prepare('DELETE FROM deployments'),
    db.prepare('DELETE FROM decks'),
    db.prepare(
      "INSERT INTO decks (id, owner_user_id, created_at) VALUES ('mine', 'alice', 1), ('theirs', 'bob', 1)",
    ),
  ])
})
afterAll(() => platform.dispose())

const inventory = (totalBytes: number) =>
  parseInventoryStructure({
    entry: 'index.html',
    files: [{ path: 'index.html', size: totalBytes, sha256: 'a'.repeat(64) }],
  })

let sequence = 0
function session(
  deckId: string,
  ownerUserId: string,
  totalBytes = 1,
): NewSession {
  sequence += 1
  return {
    id: `deployment-${sequence}`,
    key: `key-${sequence}`,
    digest: 'digest',
    deckId,
    ownerUserId,
    claims: {
      repository_id: '1',
      repository_owner_id: '2',
      actor_id: '3',
      ref: 'refs/heads/main',
      sha: 'a'.repeat(40),
      run_id: String(sequence),
      run_attempt: '1',
      event_name: 'push',
    },
    inventory: inventory(totalBytes),
    intent: null,
    tokenHash: `hash-${sequence}`,
    created: now,
  }
}

async function markReady(id: string) {
  await db
    .prepare(
      "UPDATE deployments SET state = 'ready', ready_at = ? WHERE id = ?",
    )
    .bind(now, id)
    .run()
}

test('given another account holds the whole byte quota, when an account starts an upload, then its own quota still admits it', async () => {
  const theirs = session('theirs', 'bob', 100)
  expect(await insertSessionWithinQuota(drizzle(db), theirs, limits)).toBe(true)
  await markReady(theirs.id)

  expect(
    await insertSessionWithinQuota(
      drizzle(db),
      session('mine', 'alice', 100),
      limits,
    ),
  ).toBe(true)
  expect(await readQuotaUsage(drizzle(db), 'alice', now)).toEqual({
    storedBytes: 0,
    reservedBytes: 100,
    activeSessions: 1,
    startsInWindow: 1,
  })
})

test('given an account at its byte quota, when it starts another upload, then it is refused while other accounts are not', async () => {
  const first = session('mine', 'alice', 100)
  expect(await insertSessionWithinQuota(drizzle(db), first, limits)).toBe(true)
  await markReady(first.id)

  expect(
    await insertSessionWithinQuota(
      drizzle(db),
      session('mine', 'alice', 1),
      limits,
    ),
  ).toBe(false)
  expect(
    await insertSessionWithinQuota(
      drizzle(db),
      session('theirs', 'bob', 1),
      limits,
    ),
  ).toBe(true)
})

test('given an open session of another account, when an account starts an upload, then the active session limit counts only its own', async () => {
  expect(
    await insertSessionWithinQuota(
      drizzle(db),
      session('theirs', 'bob'),
      limits,
    ),
  ).toBe(true)
  expect(
    await insertSessionWithinQuota(
      drizzle(db),
      session('mine', 'alice'),
      limits,
    ),
  ).toBe(true)
  expect(
    await insertSessionWithinQuota(
      drizzle(db),
      session('mine', 'alice'),
      limits,
    ),
  ).toBe(false)
})

test('given another account used up its daily starts, when an account starts an upload, then its own window is unaffected', async () => {
  for (let index = 0; index < limits.startsPerDay; index += 1) {
    const started = session('theirs', 'bob')
    expect(await insertSessionWithinQuota(drizzle(db), started, limits)).toBe(
      true,
    )
    await markReady(started.id)
  }
  expect(
    await insertSessionWithinQuota(
      drizzle(db),
      session('theirs', 'bob'),
      limits,
    ),
  ).toBe(false)
  expect(
    await insertSessionWithinQuota(
      drizzle(db),
      session('mine', 'alice'),
      limits,
    ),
  ).toBe(true)
  expect((await readQuotaUsage(drizzle(db), 'bob', now)).startsInWindow).toBe(2)
})

test('given another account reached its refusal cap, when an account is refused, then the refusal is still recorded', async () => {
  const refuse = (deck: string, owner: string) =>
    insertRejectedStart(
      drizzle(db),
      session(deck, owner),
      'file_too_large',
      limits,
    )
  expect(await refuse('theirs', 'bob')).toBe(true)
  expect(await refuse('theirs', 'bob')).toBe(false)
  expect(await refuse('mine', 'alice')).toBe(true)
})

test('given a deployment without a deck, when usage is read, then no account is charged for it', async () => {
  await db
    .prepare(
      `INSERT INTO deployments (id, idempotency_key, inventory_digest, source_sha, run_id, run_attempt, actor_id, repository_id, owner_id, source_ref, state, total_bytes, token_hash, created_at, expires_at, credential_expires_at, ready_at)
       VALUES ('legacy', 'legacy', 'digest', ?, '1', '1', 'alice', '1', '2', 'refs/heads/main', 'ready', 100, 'hash', ?, ?, ?, ?)`,
    )
    .bind('a'.repeat(40), now, now + 60, now + 60, now)
    .run()
  expect((await readQuotaUsage(drizzle(db), 'alice', now)).storedBytes).toBe(0)
})
