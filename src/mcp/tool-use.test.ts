import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  seedPublic,
  signIn,
  testEnv,
  withInvited,
} from '../publication/test-support'
import { callTool, connectAgent, mcpClient } from './test-connect'

const record = vi.hoisted(() => vi.fn())
vi.mock('./tool-use', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tool-use')>()),
  recordToolUse: record,
}))

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const env = withInvited(testEnv(platform.env))
let client: Awaited<ReturnType<typeof mcpClient>>

beforeAll(async () => {
  await applyMigrations(database)
  const cookie = await signIn(env, 'alice')
  await signIn(env, 'bob', { id: INVITED_ID })
  client = await mcpClient(
    env,
    (await connectAgent(env, cookie)).tokens.access_token,
  )
  await seedPublic(database, 'keynote', 200, 'SECRET-TITLE', OWNER_ID)
})
beforeEach(() => record.mockClear())
afterAll(async () => {
  await client.close()
  await platform.dispose()
})

test('D-72: Given tool calls that answer and one that is refused, When they are made, Then each is told to the counting seam once, by tool and outcome only', async () => {
  await callTool(client, 'export_account')
  await callTool(client, 'get_status', { slide: 'keynote' })
  await callTool(client, 'get_status', { slide: 'nope-SECRET' })
  expect(record.mock.calls.map(([, use]) => use)).toEqual([
    { tool: 'export_account', outcome: 'ok' },
    { tool: 'get_status', outcome: 'ok' },
    { tool: 'get_status', outcome: { refusedAs: 'unknown_slide' } },
  ])
  // Nothing the author or the agent wrote, and nothing of the answer, goes.
  expect(JSON.stringify(record.mock.calls.map(([, use]) => use))).not.toMatch(
    /SECRET|alice|mail\.example|keynote/,
  )
})

test('D-72: Given the counting seam throws, When a tool is called, Then the answer is the same', async () => {
  record.mockImplementationOnce(() => {
    throw new Error('Analytics is down')
  })
  const { isError } = await callTool(client, 'export_account')
  expect(isError).toBe(false)
})
