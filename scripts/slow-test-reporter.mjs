// A Vitest reporter that warns about slow tests and hooks without failing the
// run. The decisions live in slow-tests.mjs; this file reads the clock and
// Vitest's events and prints. See docs/dev/development.md.
import { relative } from 'node:path'
import { report, slowHook, slowTest } from './slow-tests.mjs'

export default class SlowTestReporter {
  #root = process.cwd()
  #testTimeout = 5000
  #started = new Map()
  #warnings = []

  constructor({
    now = () => performance.now(),
    write = (text) => process.stdout.write(text),
    github = process.env.GITHUB_ACTIONS === 'true',
  } = {}) {
    this.now = now
    this.write = write
    this.github = github
  }

  onInit(vitest) {
    this.#root = vitest.config.root
    this.#testTimeout = vitest.config.testTimeout
  }

  onTestCaseResult(testCase) {
    const warning = slowTest({
      file: this.#file(testCase.module),
      name: testCase.fullName,
      durationMs: testCase.diagnostic()?.duration ?? 0,
      timeoutMs: testCase.options.timeout ?? this.#testTimeout,
    })
    if (warning) this.#warnings.push(warning)
  }

  // Hooks report no duration, so it is measured here between the events.
  // Workers send events in batches every 100 ms, which is far below the
  // seconds a warning needs.
  onHookStart(hook) {
    this.#started.set(this.#key(hook), this.now())
  }

  onHookEnd(hook) {
    const key = this.#key(hook)
    const start = this.#started.get(key)
    this.#started.delete(key)
    if (start === undefined) return
    const module =
      hook.entity.type === 'module' ? hook.entity : hook.entity.module
    const warning = slowHook({
      file: this.#file(module),
      name: hook.name,
      durationMs: this.now() - start,
    })
    if (warning) this.#warnings.push(warning)
  }

  onTestRunEnd() {
    const lines = report(this.#warnings, { github: this.github })
    if (lines.length > 0) this.write(lines.join('\n') + '\n')
    this.#warnings = []
  }

  #key(hook) {
    return `${hook.name} ${hook.entity.id}`
  }

  #file(module) {
    return relative(this.#root, module.moduleId)
  }
}
