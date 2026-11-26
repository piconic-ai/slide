import { expect, test } from 'vitest'
import {
  HOOK_TIMEOUT_MS,
  HOOK_WARN_MS,
  MAX_WARNINGS,
  annotation,
  pickWarnings,
  report,
  slowHook,
  slowTest,
} from './slow-tests.mjs'

const testWarning = (durationMs, timeoutMs = 5000, name = 'a test') =>
  slowTest({ file: 'src/a.test.ts', name, durationMs, timeoutMs })

test.each([
  [0, false],
  [2499, false],
  [2500, true],
  [4999, true],
  [6000, true],
])(
  'Given a test with a 5 s timeout, When it takes %i ms, Then it is warned about: %s',
  (durationMs, warned) => {
    expect(testWarning(durationMs) !== null).toBe(warned)
  },
)

test('Given a test with its own 30 s timeout, When it takes 10 s, Then it is not warned about, and at 15 s it is', () => {
  expect(testWarning(10_000, 30_000)).toBeNull()
  expect(testWarning(15_000, 30_000)).toEqual({
    kind: 'test',
    file: 'src/a.test.ts',
    name: 'a test',
    durationMs: 15_000,
    limitMs: 30_000,
  })
})

test.each([0, -1, undefined, Number.NaN])(
  'Given a test whose timeout is %s, When it is judged, Then there is no limit to warn against',
  (timeoutMs) => {
    expect(
      slowTest({ file: 'f', name: 'n', durationMs: 60_000, timeoutMs }),
    ).toBeNull()
  },
)

test.each([undefined, Number.NaN])(
  'Given a test whose duration is %s, When it is judged, Then it is not warned about',
  (durationMs) => {
    expect(testWarning(durationMs)).toBeNull()
  },
)

test('Given hooks, When one takes just under the old 10 s timeout, Then only one at or over it is warned about, against the 60 s timeout', () => {
  const hook = (durationMs) =>
    slowHook({ file: 'src/a.test.ts', name: 'afterAll', durationMs })
  expect(HOOK_WARN_MS).toBe(10_000)
  expect(HOOK_TIMEOUT_MS).toBe(60_000)
  expect(hook(9999)).toBeNull()
  expect(hook(Number.NaN)).toBeNull()
  expect(hook(10_000)).toMatchObject({ kind: 'hook', limitMs: 60_000 })
})

test('Given more warnings than are shown, When they are picked, Then the closest to their limit come first and the rest are counted', () => {
  const warnings = Array.from({ length: MAX_WARNINGS + 3 }, (_, index) =>
    testWarning(2500 + index * 100, 5000, `test ${index}`),
  )
  const { shown, omitted } = pickWarnings(warnings)
  expect(shown).toHaveLength(MAX_WARNINGS)
  expect(shown[0].name).toBe(`test ${MAX_WARNINGS + 2}`)
  expect(omitted).toBe(3)
})

test('Given a hook and a test, When they are picked, Then they are ordered by the share of their own limit', () => {
  const hook = slowHook({ file: 'f', name: 'afterAll', durationMs: 20_000 })
  const near = testWarning(4000)
  expect(pickWarnings([hook, near]).shown).toEqual([near, hook])
})

test.each([0, -1])(
  'Given a limit of %i, When warnings are picked, Then none is shown and all are counted',
  (limit) => {
    expect(pickWarnings([testWarning(3000)], limit)).toEqual({
      shown: [],
      omitted: 1,
    })
  },
)

test('Given no slow test, When the run is reported, Then nothing is printed', () => {
  expect(report([], { github: true })).toEqual([])
  expect(report([], { github: false })).toEqual([])
})

test('Given a slow test, When the run is reported off GitHub, Then a plain line names the file, the time and the share of the timeout', () => {
  expect(report([testWarning(4000)], { github: false })).toEqual([
    'Slow tests and hooks (warning only, the run does not fail):',
    '  src/a.test.ts: test "a test" took 4.0s, 80% of its 5.0s timeout',
  ])
})

test('Given a slow hook, When the run is reported on GitHub, Then it is a warning annotation on the file', () => {
  const hook = slowHook({
    file: 'src/site/headers.test.ts',
    name: 'afterAll',
    durationMs: 12_345,
  })
  expect(report([hook], { github: true })[1]).toBe(
    '::warning file=src/site/headers.test.ts,title=Slow hook::afterAll hook took 12.3s, 21%25 of its 60.0s timeout',
  )
})

test('Given more slow tests than are shown, When the run is reported, Then the header says how many were left out', () => {
  const warnings = Array.from({ length: MAX_WARNINGS + 2 }, () =>
    testWarning(3000),
  )
  const lines = report(warnings, { github: false })
  expect(lines).toHaveLength(MAX_WARNINGS + 1)
  expect(lines[0]).toContain('2 more not shown')
})

test('Given names and paths with characters GitHub reads as commands, When annotated, Then they are escaped and stay on one line', () => {
  const line = annotation(
    slowTest({
      file: 'src/a,b:c%.test.ts',
      name: '100% done\r\n::error::injected',
      durationMs: 3000,
      timeoutMs: 5000,
    }),
  )
  expect(line).toBe(
    '::warning file=src/a%2Cb%3Ac%25.test.ts,title=Slow test::test "100%25 done%0D%0A::error::injected" took 3.0s, 60%25 of its 5.0s timeout',
  )
  expect(line).not.toMatch(/[\r\n]/)
})
