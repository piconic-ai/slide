// Usage: node scripts/db-er.mjs [--check]
// Writes docs/dev/er-diagram.md from migrations/, or with --check only
// verifies that the committed file is what would be written.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { compareDocument } from './er-check.mjs'
import { DOCUMENT_PATH, generateDocument } from './er-generate.mjs'

const generated = generateDocument()
if (process.argv.includes('--check')) {
  const committed = existsSync(DOCUMENT_PATH)
    ? readFileSync(DOCUMENT_PATH, 'utf8')
    : null
  const result = compareDocument(committed, generated)
  if (!result.ok) {
    console.error(result.message)
    process.exit(1)
  }
  console.log(`${DOCUMENT_PATH} is up to date.`)
} else {
  writeFileSync(DOCUMENT_PATH, generated)
  console.log(`Wrote ${DOCUMENT_PATH}.`)
}
