#!/usr/bin/env node
// Runs a load script against a local Worker, or a test environment kept apart
// from production. It refuses the production origins. See docs/dev/scale-cost.md
// for the procedure; the command is in run-command.mjs.
import { readFile } from 'node:fs/promises'
import { setTimeout as wait } from 'node:timers/promises'
import { performance } from 'node:perf_hooks'
import { main } from './run-command.mjs'

process.exitCode = await main(process.argv.slice(2), {
  send: (address, init) => fetch(address, init),
  now: () => performance.now(),
  sleep: (ms) => wait(ms),
  timeoutSignal: (ms) => AbortSignal.timeout(ms),
  readFile: (path) => readFile(path, 'utf8'),
  print: (text) => console.log(text),
  printError: (text) => console.error(text),
})
