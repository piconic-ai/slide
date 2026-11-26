import { expect, test } from 'vitest'
import { readFrames } from './operator-frames'

const env = {} as Env

test('Given readers, When read, Then each answer is kept under its own name and every reader sees the environment', async () => {
  const seen: Env[] = []
  const views = await readFrames(
    {
      one: async (e: Env) => (seen.push(e), { kind: 'one' as const }),
      two: async (e: Env) => (seen.push(e), { kind: 'two' as const }),
    },
    env,
  )
  expect(views).toEqual({ one: { kind: 'one' }, two: { kind: 'two' } })
  expect(seen).toEqual([env, env])
})

test('Given no readers, When read, Then the result is empty', async () => {
  expect(await readFrames({}, env)).toEqual({})
})

test('Given one reader that fails, When read, Then the failure is not swallowed', async () => {
  await expect(
    readFrames(
      {
        ok: async () => 1,
        bad: async () => {
          throw new Error('boom')
        },
      },
      env,
    ),
  ).rejects.toThrow('boom')
})
