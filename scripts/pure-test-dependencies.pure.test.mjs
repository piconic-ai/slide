import { expect, test } from 'vitest'
import { pureTestViolations } from './pure-test-dependencies.mjs'

const suite = 'src/example.pure.test.ts'
function issues(source, helpers = {}) {
  return pureTestViolations(
    new Map(Object.entries({ [suite]: source, ...helpers })),
  )
}

test.each([
  ['import "wrangler"', 'wrangler'],
  ['await import("playwright")', 'playwright'],
  ['require("node:child_process")', 'node:child_process'],
  ['import("fs/promises")', 'fs/promises'],
  ['fetch(url)', 'fetch'],
  ['globalThis.crypto.getRandomValues(bytes)', 'crypto.getRandomValues'],
  ['performance.now()', 'performance.now'],
  ['import {randomUUID as id} from "node:crypto"', 'crypto.randomUUID'],
  [
    'import crypto from "node:crypto"; crypto.randomBytes(16)',
    'crypto.randomBytes',
  ],
  ['Date()', 'clock'],
  ['new Date()', 'clock'],
  ['process.env.TOKEN', 'process.env'],
  ["env['DB'].prepare(query)", 'env.DB'],
  ['import(backend)', 'computed module import'],
  ['import "./missing"', 'unresolved import ./missing'],
])('Given %s, then the pure suite reports %s', (source, boundary) => {
  expect(issues(source)).toEqual([[suite, boundary]])
})

test('Given a shared helper re-exported through a cycle, then the diagnostic names the full path to the side effect', () => {
  expect(
    issues('import "./helper"', {
      'src/helper.ts': 'export * from "./index.js"',
      'src/index.ts': 'import "./helper"; export { x } from "node:fs"',
    }),
  ).toEqual([[suite, 'src/helper.ts', 'src/index.ts', 'node:fs']])
})

test('Given a store reached through a local component alias, then the pure suite points to the boundary', () => {
  expect(
    issues('await import("@/components/ui")', {
      'components/ui/index.tsx': 'import "../../src/items/store"',
      'src/items/store.ts': 'export const read = db => db.prepare("SELECT 1")',
    }),
  ).toEqual([[suite, 'components/ui/index.tsx', 'src/items/store.ts']])
})

test('Given type-only dependencies, example code in strings, explicit dates and deterministic helpers, then nothing reaches the environment', () => {
  expect(
    issues(
      `
    import { type Platform } from "wrangler"
    export type { Page } from "playwright"
    import { createHmac } from 'node:crypto'
    import type { randomBytes } from 'node:crypto'
    import { join } from 'node:path'
    import './data.json'
    import './helper'
    // await fetch("https://example.com")
    const fixture = "Date.now()"
    new Date(0)
    crypto.subtle.digest('SHA-256', bytes)
  `,
      { 'src/helper.ts': 'import "./helper"' },
    ),
  ).toEqual([])
})

test('Given ordinary suites, then only a suite with no external dependencies needs the pure name', () => {
  expect(
    pureTestViolations(
      new Map([
        ['src/empty.test.ts', 'expect(1 + 1).toBe(2)'],
        ['src/db.test.ts', 'import "wrangler"'],
        ['src/no-effect.pure.spec.ts', 'expect(1).toBe(1)'],
        ['src/deadline.test.ts', 'AbortSignal.timeout(30)'],
        ['src/service.integration.test.ts', 'import "vendor-test-harness"'],
        ['src/page.browser.test.ts', 'import "browser-harness"'],
        ['src/size.performance.test.ts', 'import "benchmark-runner"'],
      ]),
    ),
  ).toEqual([
    [
      'src/empty.test.ts',
      'use .pure.test for a suite without runtime dependencies',
    ],
  ])
})

test.each(['js', 'jsx', 'cjs', 'mjs', 'cts', 'mts', 'tsx'])(
  'Given a .%s suite inside a browser-named folder, then classification uses the filename',
  (extension) => {
    const path = 'example.browser.test.folder/helper.pure.test.' + extension
    expect(
      pureTestViolations(new Map([[path, 'await import("wrangler")']])),
    ).toEqual([[path, 'wrangler']])
  },
)
