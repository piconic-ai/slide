// Pure decisions for slow-test warnings: which tests and hooks are slow
// enough to warn about, which warnings to show, and how to print them.
// A warning never fails the run; only Vitest's own timeouts do.

/**
 * A test that uses half of its own timeout is warned about. On CI in
 * 2026-11 about five to eight of some 6,600 tests per run crossed this line,
 * so the warning stays rare while flagging the tests close to failing.
 */
export const TEST_WARN_RATIO = 0.5

/**
 * A hook (such as `afterAll(() => platform.dispose())`) that takes this long
 * is warned about. It is Vitest's default hook timeout, which CI's disposes
 * have occasionally exceeded (#546).
 */
export const HOOK_WARN_MS = 10_000

/**
 * A hook fails the run only after this long, six times the warning, where
 * a dispose is stuck rather than slow. Set as `hookTimeout` in
 * vitest.config.ts.
 */
export const HOOK_TIMEOUT_MS = 60_000

/** At most this many warnings are printed; GitHub shows ten per step. */
export const MAX_WARNINGS = 10

/**
 * The warning for a finished test, or null when it is fast enough. A test
 * without a positive timeout has no limit to compare with.
 */
export function slowTest({ file, name, durationMs, timeoutMs }) {
  if (!(timeoutMs > 0) || !(durationMs >= timeoutMs * TEST_WARN_RATIO))
    return null
  return {
    kind: 'test',
    file,
    name,
    durationMs,
    limitMs: timeoutMs,
  }
}

/** The warning for a finished hook, or null when it is fast enough. */
export function slowHook({ file, name, durationMs }) {
  if (!(durationMs >= HOOK_WARN_MS)) return null
  return {
    kind: 'hook',
    file,
    name,
    durationMs,
    limitMs: HOOK_TIMEOUT_MS,
  }
}

/**
 * The warnings to print, closest to their limit first, and how many more
 * were left out.
 */
export function pickWarnings(warnings, limit = MAX_WARNINGS) {
  const sorted = [...warnings].sort(
    (a, b) => b.durationMs / b.limitMs - a.durationMs / a.limitMs,
  )
  return {
    shown: sorted.slice(0, Math.max(0, limit)),
    omitted: Math.max(0, sorted.length - Math.max(0, limit)),
  }
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`

/**
 * One line describing the warning, for people and for annotations. A hook's
 * own timeout, when one is passed, is not reported to reporters, so a hook
 * is described against the thresholds rather than its limit.
 */
export function describeWarning(warning) {
  if (warning.kind === 'hook')
    return `${warning.name} hook took ${seconds(warning.durationMs)} (warns at ${seconds(HOOK_WARN_MS)}; hookTimeout is ${seconds(HOOK_TIMEOUT_MS)})`
  const percent = Math.round((warning.durationMs / warning.limitMs) * 100)
  return `test "${warning.name}" took ${seconds(warning.durationMs)}, ${percent}% of its ${seconds(warning.limitMs)} timeout`
}

// GitHub workflow commands: https://docs.github.com/actions/reference/workflow-commands-for-github-actions
const escapeData = (text) =>
  String(text)
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')

const escapeProperty = (text) =>
  escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C')

/** The warning as a GitHub Actions annotation on the test file. */
export function annotation(warning) {
  const title = warning.kind === 'hook' ? 'Slow hook' : 'Slow test'
  return `::warning file=${escapeProperty(warning.file)},title=${escapeProperty(title)}::${escapeData(describeWarning(warning))}`
}

/**
 * The lines printed at the end of a run: annotations on GitHub Actions,
 * plain lines elsewhere. Nothing is printed when no test was slow.
 */
export function report(warnings, { github }) {
  const { shown, omitted } = pickWarnings(warnings)
  if (shown.length === 0) return []
  const lines = shown.map((warning) =>
    github
      ? annotation(warning)
      : `  ${warning.file}: ${describeWarning(warning)}`,
  )
  const more = omitted > 0 ? `, ${omitted} more not shown` : ''
  return [
    `Slow tests and hooks (warning only, the run does not fail${more}):`,
    ...lines,
  ]
}
