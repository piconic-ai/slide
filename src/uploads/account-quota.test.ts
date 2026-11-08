import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { decks, deployments, uploadFiles } from '../db/schema'
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
const db = drizzle(platform.env.DB)
const now = Math.floor(Date.now() / 1000)
const limits = parseUploadLimits({
  authorBytes: 100,
  deploymentBytes: 100,
  fileBytes: 100,
  startsPerDay: 2,
  refusalsPerDay: 1,
})

beforeAll(() => applyMigrations(platform.env.DB))
beforeEach(async () => {
  await db.batch([
    db.delete(uploadFiles),
    db.delete(deployments),
    db.delete(decks),
    db.insert(decks).values([
      { id: 'mine', owner_user_id: 'alice', created_at: 1 },
      { id: 'theirs', owner_user_id: 'bob', created_at: 1 },
    ]),
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
    .update(deployments)
    .set({ state: 'ready', ready_at: now })
    .where(eq(deployments.id, id))
}

test('given another account holds the whole byte quota, when an account starts an upload, then its own quota still admits it', async () => {
  const theirs = session('theirs', 'bob', 100)
  expect(await insertSessionWithinQuota(db, theirs, limits)).toBe(true)
  await markReady(theirs.id)

  expect(
    await insertSessionWithinQuota(db, session('mine', 'alice', 100), limits),
  ).toBe(true)
  expect(await readQuotaUsage(db, 'alice', now)).toEqual({
    storedBytes: 0,
    reservedBytes: 100,
    activeSessions: 1,
    startsInWindow: 1,
  })
})

test('given an account at its byte quota, when it starts another upload, then it is refused while other accounts are not', async () => {
  const first = session('mine', 'alice', 100)
  expect(await insertSessionWithinQuota(db, first, limits)).toBe(true)
  await markReady(first.id)

  expect(
    await insertSessionWithinQuota(db, session('mine', 'alice', 1), limits),
  ).toBe(false)
  expect(
    await insertSessionWithinQuota(db, session('theirs', 'bob', 1), limits),
  ).toBe(true)
})

test('given an open session of another account, when an account starts an upload, then the active session limit counts only its own', async () => {
  expect(
    await insertSessionWithinQuota(db, session('theirs', 'bob'), limits),
  ).toBe(true)
  expect(
    await insertSessionWithinQuota(db, session('mine', 'alice'), limits),
  ).toBe(true)
  expect(
    await insertSessionWithinQuota(db, session('mine', 'alice'), limits),
  ).toBe(false)
})

test('given another account used up its daily starts, when an account starts an upload, then its own window is unaffected', async () => {
  for (let index = 0; index < limits.startsPerDay; index += 1) {
    const started = session('theirs', 'bob')
    expect(await insertSessionWithinQuota(db, started, limits)).toBe(true)
    await markReady(started.id)
  }
  expect(
    await insertSessionWithinQuota(db, session('theirs', 'bob'), limits),
  ).toBe(false)
  expect(
    await insertSessionWithinQuota(db, session('mine', 'alice'), limits),
  ).toBe(true)
  expect((await readQuotaUsage(db, 'bob', now)).startsInWindow).toBe(2)
})

test('given another account reached its refusal cap, when an account is refused, then the refusal is still recorded', async () => {
  const refuse = (deck: string, owner: string) =>
    insertRejectedStart(db, session(deck, owner), 'file_too_large', limits)
  expect(await refuse('theirs', 'bob')).toBe(true)
  expect(await refuse('theirs', 'bob')).toBe(false)
  expect(await refuse('mine', 'alice')).toBe(true)
})

test('given a deployment without a deck, when usage is read, then no account is charged for it', async () => {
  await db.insert(deployments).values({
    id: 'legacy',
    idempotency_key: 'legacy',
    inventory_digest: 'digest',
    source_sha: 'a'.repeat(40),
    run_id: '1',
    run_attempt: '1',
    actor_id: 'alice',
    repository_id: '1',
    owner_id: '2',
    source_ref: 'refs/heads/main',
    state: 'ready',
    total_bytes: 100,
    token_hash: 'hash',
    created_at: now,
    expires_at: now + 60,
    credential_expires_at: now + 60,
    ready_at: now,
  })
  expect((await readQuotaUsage(db, 'alice', now)).storedBytes).toBe(0)
})
