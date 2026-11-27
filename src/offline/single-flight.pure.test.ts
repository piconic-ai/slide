import { expect, test } from 'vitest'
import { singleFlight } from './single-flight'

/** A job whose runs are finished by the test, one at a time. */
function gatedJob() {
  const gates: (() => void)[] = []
  const log = { started: 0, running: 0, mostAtOnce: 0 }
  const job = (_: void) =>
    new Promise<void>((resolve) => {
      log.started += 1
      log.running += 1
      log.mostAtOnce = Math.max(log.mostAtOnce, log.running)
      gates.push(() => {
        log.running -= 1
        resolve()
      })
    })
  return { job, log, finish: () => gates.shift()?.() }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test('F37-AC22: Given no run in progress, When it is called, Then the job runs once', async () => {
  const { job, log, finish } = gatedJob()
  const run = singleFlight(job)
  const done = run()
  finish()
  await done
  expect(log.started).toBe(1)
})

test('F37-AC22: Given a run in progress, When it is called again, Then the job never runs twice at once and runs once more after', async () => {
  const { job, log, finish } = gatedJob()
  const run = singleFlight(job)
  const first = run()
  const second = run()
  await tick()
  expect(log.started).toBe(1)
  finish()
  await tick()
  expect(log.started).toBe(2)
  finish()
  await Promise.all([first, second])
  expect(log.mostAtOnce).toBe(1)
})

test('F37-AC22: Given several calls during one run, When the run ends, Then they share one follow-up run', async () => {
  const { job, log, finish } = gatedJob()
  const run = singleFlight(job)
  const calls = [run(), run(), run(), run()]
  finish()
  await tick()
  finish()
  await Promise.all(calls)
  expect(log.started).toBe(2)
})

test('F37-AC22: Given a run that has ended, When it is called, Then a new run starts', async () => {
  const { job, log, finish } = gatedJob()
  const run = singleFlight(job)
  const first = run()
  finish()
  await first
  const second = run()
  finish()
  await second
  expect(log.started).toBe(2)
})

test('F37-AC22: Given calls with different arguments during a run, When the follow-up run starts, Then it gets the latest argument', async () => {
  const seen: string[] = []
  const gates: (() => void)[] = []
  const run = singleFlight(
    (arg: string) =>
      new Promise<void>((resolve) => {
        seen.push(arg)
        gates.push(resolve)
      }),
  )
  const calls = [run('a'), run('b'), run('c')]
  gates.shift()?.()
  await tick()
  gates.shift()?.()
  await Promise.all(calls)
  expect(seen).toEqual(['a', 'c'])
})

test('F37-AC22: Given a run that fails, When it is called again, Then the failure reaches the caller and the next call runs the job', async () => {
  let calls = 0
  const run = singleFlight(async (_: void) => {
    calls += 1
    if (calls === 1) throw new Error('offline')
  })
  await expect(run()).rejects.toThrow('offline')
  await run()
  expect(calls).toBe(2)
})
