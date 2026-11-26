#!/usr/bin/env node
// Prints the SQL that fills an empty D1 with the data the cost and load
// measurements use (dataset-sql.mjs): 10,000 slides and 1,000 people unless
// the sizes are given. It sends nothing anywhere; the operator runs the
// output against the database of an environment kept apart from production.
//
//   node scripts/load/make-dataset-sql.mjs > dataset.sql
//   node scripts/load/make-dataset-sql.mjs --slides 2000 --people 200 > small.sql
import { datasetStatements, LARGE_DATASET } from './dataset-sql.mjs'

const OPTIONS = {
  '--people': 'people',
  '--slides': 'slides',
  '--files-per-slide': 'filesPerSlide',
  '--follows-per-person': 'followsPerPerson',
  '--citations': 'citations',
  '--communities': 'communities',
  '--community-followers': 'communityFollowers',
}

const size = { ...LARGE_DATASET }
const argv = process.argv.slice(2)
for (let at = 0; at < argv.length; at += 2) {
  const name = Object.hasOwn(OPTIONS, argv[at]) ? OPTIONS[argv[at]] : null
  const value = Number(argv[at + 1])
  if (!name || !Number.isInteger(value) || value < 1)
    throw new Error(`Unknown option or bad number at ${argv[at]}`)
  size[name] = value
}
console.log(
  datasetStatements(size)
    .map((statement) => `${statement};`)
    .join('\n'),
)
