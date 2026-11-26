#!/usr/bin/env node
// Prints the monthly cost estimate of docs/dev/scale-cost.md (D-140). The
// command itself, with its options, is in estimate-command.mjs.
import { readFile } from 'node:fs/promises'
import { main } from './estimate-command.mjs'

await main(process.argv.slice(2), {
  readFile: (path) => readFile(path, 'utf8'),
  today: () => new Date().toISOString().slice(0, 10),
  print: (text) => console.log(text),
}).catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
