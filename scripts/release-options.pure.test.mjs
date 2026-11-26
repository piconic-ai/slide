import { expect, test } from 'vitest'
import {
  parseArgs,
  redacted,
  refusal,
  varsOfWranglerConfig,
} from './release-options.mjs'

const none = new Set()

test.each([
  [{}, 'no WORKERS_CI'],
  [{ WORKERS_CI: '0', WORKERS_CI_BRANCH: 'release' }, 'WORKERS_CI is 0'],
  [{ WORKERS_CI: '1' }, 'no branch'],
  [{ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main' }, 'the main branch'],
  [{ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'releases' }, 'a look-alike branch'],
  [{ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'feat/x' }, 'a preview branch'],
  [{ WORKERS_CI: '1', WORKERS_CI_BRANCH: '' }, 'an empty branch'],
])(
  'REL-AC10: Given %j (%s), When the run is judged, Then it is refused before anything runs',
  (env) => {
    expect(refusal(env, none)).toEqual(expect.any(String))
  },
)

test('REL-AC10: Given Workers Builds building the release branch, When the run is judged, Then it may go on', () => {
  expect(
    refusal({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'release' }, none),
  ).toBeNull()
})

test('REL-AC10: Given the explicit flag in a Workers Builds build of another branch, When the run is judged, Then it is still refused', () => {
  for (const branch of ['main', 'feat/x', undefined])
    expect(
      refusal(
        { WORKERS_CI: '1', WORKERS_CI_BRANCH: branch },
        new Set(['allow-outside-ci']),
      ),
    ).toEqual(expect.any(String))
})

test('REL-AC10: Given the explicit flag, When the run is judged outside Workers Builds, Then it may go on', () => {
  expect(refusal({}, new Set(['allow-outside-ci']))).toBeNull()
})

test('REL-AC10: Given the arguments, When they are read, Then options and the one flag are kept and anything else is refused', () => {
  const parsed = parseArgs([
    '--database',
    'slide',
    '--allow-outside-ci',
    '--site',
    'https://a.example',
  ])
  expect(parsed?.options).toEqual({
    database: 'slide',
    site: 'https://a.example',
  })
  expect(parsed?.flags.has('allow-outside-ci')).toBe(true)
  expect(parseArgs(['stray'])).toBeNull()
  expect(parseArgs(['--site'])).toBeNull()
  expect(parseArgs(['--'])).toBeNull()
  expect(parseArgs([])).toEqual({ options: {}, flags: new Set() })
})

test('REL-AC7: Given secrets, When a log text is redacted, Then every copy of each is replaced and empty or missing secrets change nothing', () => {
  const text = 'a SECRET-1 b SECRET-1 c TOKEN-2 d'
  expect(redacted(text, ['SECRET-1', 'TOKEN-2'])).toBe(
    'a [redacted] b [redacted] c [redacted] d',
  )
  expect(redacted(text, [undefined, '', null])).toBe(text)
})

test('REL-AC10: Given the configuration text with comments and trailing commas, When its vars are read, Then they come out', () => {
  const text = `{
  // a comment
  "name": "slide",
  "vars": {
    "PUBLIC_ORIGIN": "https://slide.community",
    "UPLOAD_LIMITS": {},
  },
}`
  expect(varsOfWranglerConfig(text)).toMatchObject({
    PUBLIC_ORIGIN: 'https://slide.community',
  })
  expect(varsOfWranglerConfig('{}')).toEqual({})
})
