import { expect, test } from 'vitest'
import { serialQueue } from './serial-queue'

/** A promise the test settles by hand. */
function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Lets every promise that can settle without outside help settle. */
const settle = async () => {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
}

test('F37-AC22: Given a task in progress, When another is added, Then it starts only after the first has finished', async () => {
  const run = serialQueue()
  const log: string[] = []
  const gate = deferred()
  const first = run(async () => {
    log.push('first starts')
    await gate.promise
    log.push('first ends')
  })
  const second = run(async () => {
    log.push('second starts')
  })
  await settle()
  expect(log).toEqual(['first starts'])
  gate.resolve()
  await Promise.all([first, second])
  expect(log).toEqual(['first starts', 'first ends', 'second starts'])
})

test('F37-AC22: Given several tasks, When they are added, Then they run in the order added and each answers with its own value', async () => {
  const run = serialQueue()
  const gates = [deferred(), deferred(), deferred()]
  const order: number[] = []
  const answers = gates.map((gate, index) =>
    run(async () => {
      order.push(index)
      await gate.promise
      return index * 10
    }),
  )
  // Released in the opposite order: they still run one after another.
  for (const gate of [...gates].reverse()) gate.resolve()
  expect(await Promise.all(answers)).toEqual([0, 10, 20])
  expect(order).toEqual([0, 1, 2])
})

test('F37-AC22: Given a task that fails, When another is added, Then the failure reaches only its own caller and the next task runs', async () => {
  const run = serialQueue()
  const failing = run(async () => {
    throw new Error('offline')
  })
  const next = run(async () => 'ran')
  await expect(failing).rejects.toThrow('offline')
  await expect(next).resolves.toBe('ran')
})

test('F37-AC22: Given a queue that has gone idle, When a task is added, Then it runs', async () => {
  const run = serialQueue()
  await run(async () => {})
  await settle()
  await expect(run(async () => 'again')).resolves.toBe('again')
})

test('F37-AC22: Given a task that adds another from inside, When the queue runs, Then the inner one runs after the outer one has finished', async () => {
  const run = serialQueue()
  const log: string[] = []
  let inner: Promise<void> | undefined
  await run(async () => {
    inner = run(async () => void log.push('inner'))
    log.push('outer')
  })
  await inner
  expect(log).toEqual(['outer', 'inner'])
})
