import { expect, test } from 'vitest'
import config from '../vitest.config.ts'
import SlowTestReporter from './slow-test-reporter.mjs'
import { HOOK_TIMEOUT_MS } from './slow-tests.mjs'

// Vitest's reported entities, reduced to what the reporter reads.
const module = { type: 'module', id: 'm1', moduleId: '/repo/src/a.test.ts' }
const testCase = ({ duration, timeout, name = 'a test' }) => ({
  type: 'test',
  id: `t-${name}`,
  module,
  fullName: name,
  options: { timeout },
  diagnostic: () => (duration === undefined ? undefined : { duration }),
})

function reporter({ github = false } = {}) {
  let clock = 0
  const out = []
  const instance = new SlowTestReporter({
    now: () => clock,
    write: (text) => out.push(text),
    github,
  })
  instance.onInit({ config: { root: '/repo', testTimeout: 5000 } })
  return {
    instance,
    out,
    advance: (ms) => {
      clock += ms
    },
  }
}

test('Given a run whose tests and hooks are fast, When it ends, Then the reporter prints nothing', () => {
  const { instance, out, advance } = reporter()
  instance.onTestCaseResult(testCase({ duration: 100, timeout: 5000 }))
  instance.onTestCaseResult(testCase({ duration: undefined, timeout: 5000 }))
  instance.onHookStart({ name: 'afterAll', entity: module })
  advance(500)
  instance.onHookEnd({ name: 'afterAll', entity: module })
  instance.onTestRunEnd()
  expect(out).toEqual([])
})

test('Given a test near its timeout and a slow dispose, When the run ends on GitHub, Then both are warning annotations on the file', () => {
  const { instance, out, advance } = reporter({ github: true })
  instance.onTestCaseResult(testCase({ duration: 4000, timeout: 5000 }))
  instance.onHookStart({ name: 'afterAll', entity: module })
  advance(15_000)
  instance.onHookEnd({ name: 'afterAll', entity: module })
  instance.onTestRunEnd()
  expect(out.join('')).toBe(
    [
      'Slow tests and hooks (warning only, the run does not fail):',
      '::warning file=src/a.test.ts,title=Slow test::test "a test" took 4.0s, 80%25 of its 5.0s timeout',
      '::warning file=src/a.test.ts,title=Slow hook::afterAll hook took 15.0s, 25%25 of its 60.0s timeout',
      '',
    ].join('\n'),
  )
})

test("Given a test without its own timeout, When it takes 3 s, Then it is judged against the config's timeout", () => {
  const { instance, out } = reporter()
  instance.onTestCaseResult(testCase({ duration: 3000, timeout: undefined }))
  instance.onTestRunEnd()
  expect(out.join('')).toContain('60% of its 5.0s timeout')
})

test("Given a slow beforeEach of a test, When it ends, Then it is reported on the test's file", () => {
  const { instance, out, advance } = reporter()
  const entity = testCase({ duration: 0, timeout: 5000 })
  instance.onHookStart({ name: 'beforeEach', entity })
  advance(10_000)
  instance.onHookEnd({ name: 'beforeEach', entity })
  instance.onTestRunEnd()
  expect(out.join('')).toContain('src/a.test.ts: beforeEach hook took 10.0s')
})

test('Given a hook end without its start, When the run ends, Then it is ignored', () => {
  const { instance, out } = reporter()
  instance.onHookEnd({ name: 'afterAll', entity: module })
  instance.onTestRunEnd()
  expect(out).toEqual([])
})

test('Given a run that reported a slow test, When a second run ends, Then the first run’s warning is not printed again', () => {
  const { instance, out } = reporter()
  instance.onTestCaseResult(testCase({ duration: 4000, timeout: 5000 }))
  instance.onTestRunEnd()
  instance.onTestRunEnd()
  expect(out).toHaveLength(1)
})

test('Given the defaults, When the reporter is made, Then it prints to stdout and reads GITHUB_ACTIONS', () => {
  const instance = new SlowTestReporter()
  expect(instance.github).toBe(process.env.GITHUB_ACTIONS === 'true')
  expect(typeof instance.now()).toBe('number')
})

test('Given the Vitest config, When hooks run, Then they fail at the timeout the warnings measure against, and the reporter is on', () => {
  expect(config.test.hookTimeout).toBe(HOOK_TIMEOUT_MS)
  expect(config.test.reporters).toContain('./scripts/slow-test-reporter.mjs')
})
