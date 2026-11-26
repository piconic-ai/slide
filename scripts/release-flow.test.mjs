import { execFile } from 'node:child_process'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'

// The release flow's files read as text: the Worker's configuration, the
// tagpr settings and the workflow. Nothing here starts GitHub Actions or
// reaches GitHub; the one place the workflow's shell runs, `gh` is a stub.
// docs/dev/release-flow.md lists the promises (REL-AC1 to REL-AC5, REL-AC13).

const TAG = 'v0.4.0'
const SHA = 'a'.repeat(40)

const text = (path) => readFile(path, 'utf8')

async function wranglerConfig() {
  const source = await text('wrangler.jsonc')
  const json = source.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')
  return JSON.parse(json)
}

test('REL-AC1: Given the checked-in Worker configuration, When it is read, Then the name, account, routes, D1, R2, limits and access settings are those of production before the release flow, and no environment is added', async () => {
  const config = await wranglerConfig()
  expect(config.name).toBe('slide')
  expect(config.account_id).toBe('e680616185a3b617a32987a6571991b7')
  expect(config.routes).toEqual([
    { pattern: 'slide.community', custom_domain: true },
    { pattern: 'admin.slide.community', custom_domain: true },
    { pattern: '*.slideusercontent.com/*', zone_name: 'slideusercontent.com' },
  ])
  expect(config.d1_databases).toEqual([
    {
      binding: 'DB',
      database_name: 'slide',
      database_id: '8461532c-0fca-4eea-9513-d0ff800c0385',
    },
  ])
  expect(config.r2_buckets).toEqual([
    { binding: 'UPLOADS', bucket_name: 'slide-uploads' },
  ])
  expect(
    Object.fromEntries(
      config.ratelimits.map((one) => [
        one.name,
        [one.simple.limit, one.simple.period],
      ]),
    ),
  ).toEqual({
    AUTH_RATE_LIMITER: [30, 60],
    UPLOAD_RATE_LIMITER: [600, 60],
    MANAGEMENT_RATE_LIMITER: [120, 60],
    VIEWER_RATE_LIMITER: [5000000, 60],
    CONTENT_RATE_LIMITER: [6000000, 60],
    PAGE_SHOT_RATE_LIMITER: [6, 60],
  })
  expect(config.vars).toMatchObject({
    CONTENT_ORIGIN: 'https://slideusercontent.com',
    PUBLIC_ORIGIN: 'https://slide.community',
    OPERATOR_ORIGIN: 'https://admin.slide.community',
    ACCESS_TEAM_DOMAIN: 'https://piconic-ai.cloudflareaccess.com',
    ACCESS_AUD:
      '75d8648d91d36070a1a37d1c93374a597c2bf842c65f022d4ee004e2a39f3c91',
  })
  expect(config).not.toHaveProperty('env')
})

test('REL-AC2: Given .tagpr, When its settings are read, Then versions are v-prefixed tags cut from main with no version file and a changelog', async () => {
  const settings = Object.fromEntries(
    (await text('.tagpr'))
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('['))
      .map((line) => line.split(/\s*=\s*/)),
  )
  expect(settings).toEqual({
    vPrefix: 'true',
    releaseBranch: 'main',
    versionFile: '-',
    changelog: 'true',
  })
})

/** The text of one top-level key of a workflow: from its line to the next key. */
function topLevel(workflow, key) {
  const match = new RegExp(`^${key}:.*\\n(?:(?:[ \\t].*)?\\n)*`, 'm').exec(
    workflow,
  )
  return match?.[0] ?? ''
}

/** The jobs of a workflow, by id, each with its text. */
function jobsOf(workflow) {
  const body = topLevel(workflow, 'jobs')
  const parts = body.split(/^  ([A-Za-z0-9_-]+):\n/m).slice(1)
  const jobs = {}
  for (let i = 0; i < parts.length; i += 2) jobs[parts[i]] = parts[i + 1]
  return jobs
}

/** The `key: value` lines directly under a `permissions:` heading. */
const permissionsOf = (block) =>
  [
    ...(/^ *permissions:\n((?: {6,}\S.*\n)+)/m.exec(block)?.[1] ?? '').matchAll(
      /(\S+): (\S+)/g,
    ),
  ].map(([, name, level]) => `${name}: ${level}`)

test('REL-AC3: Given the tagpr workflow, When its triggers are read, Then it runs only on a push to main', async () => {
  const workflow = await text('.github/workflows/tagpr.yml')
  expect(
    topLevel(workflow, 'on').replace(/#.*$/gm, '').replace(/\s+/g, ' ').trim(),
  ).toBe('on: push: branches: [main]')
})

test('REL-AC3: Given the tagpr workflow, When its permissions are read, Then the workflow reads only and each job asks for just what it writes', async () => {
  const workflow = await text('.github/workflows/tagpr.yml')
  expect(topLevel(workflow, 'permissions').trim()).toBe(
    'permissions:\n  contents: read',
  )
  const jobs = jobsOf(workflow)
  expect(Object.keys(jobs)).toEqual([
    'tagpr',
    'advance-release-branch',
    'run-ci-on-release-pr',
  ])
  expect(permissionsOf(jobs.tagpr)).toEqual([
    'contents: write',
    'pull-requests: write',
    'issues: read',
  ])
  expect(permissionsOf(jobs['advance-release-branch'])).toEqual([
    'contents: write',
  ])
  expect(permissionsOf(jobs['run-ci-on-release-pr'])).toEqual([
    'actions: write',
    'pull-requests: read',
  ])
})

test('REL-AC3: Given the tagpr workflow, When its steps are read, Then tagpr gets the workflow token only, nothing checked out keeps credentials, and no shell step interpolates an expression', async () => {
  const workflow = await text('.github/workflows/tagpr.yml')
  const jobs = jobsOf(workflow)
  expect(jobs.tagpr).toContain('persist-credentials: false')
  expect(jobs.tagpr).toContain('GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}')
  expect(workflow).not.toMatch(/secrets\.(?!GITHUB_TOKEN\b)/)
  const run = jobs['advance-release-branch'].split('run: |\n')[1]
  expect(run).toBeTruthy()
  expect(run).not.toContain('${{')
  expect(jobs['advance-release-branch']).not.toContain('actions/checkout')
})

test('REL-AC4: Given the job that moves release, When its condition is read, Then it needs the tagpr job and runs only when tagpr output a tag', async () => {
  const jobs = jobsOf(await text('.github/workflows/tagpr.yml'))
  const advance = jobs['advance-release-branch']
  expect(advance).toMatch(/^ {4}needs: tagpr$/m)
  expect(advance).toMatch(/^ {4}if: needs\.tagpr\.outputs\.tag != ''$/m)
  expect(jobs.tagpr).toContain('tag: ${{ steps.tagpr.outputs.tag }}')
  expect(advance).toContain('TAG: ${{ needs.tagpr.outputs.tag }}')
})

test('REL-AC4: Given the workflow, When it is searched for ways to force a branch, Then force is always off and git push is never used', async () => {
  const workflow = await text('.github/workflows/tagpr.yml')
  const code = workflow.replace(/^\s*#.*$/gm, '')
  expect(code).toContain('-F force=false')
  expect(code).not.toMatch(
    /force=true|--force|-f force|\+refs|git push|git reset/,
  )
  expect(code).not.toMatch(/refs\/heads\/(?!release\b)/)
})

test('REL-AC5: Given the tagpr workflow, When its actions are read, Then every one is pinned in actions.lock for this workflow', async () => {
  const workflow = await text('.github/workflows/tagpr.yml')
  const lock = await text('.github/workflows/actions.lock')
  const used = [...workflow.matchAll(/^\s*(?:- )?uses: (\S+)/gm)].map(
    (match) => match[1],
  )
  expect(used).toEqual(['actions/checkout@v7.0.1', 'Songmu/tagpr@v1.21.4'])
  const section =
    /'\.github\/workflows\/tagpr\.yml':\n((?: {8}- .*\n)+)/.exec(lock)?.[1] ??
    ''
  const locked = [...section.matchAll(/- '([^']+)'/g)].map((match) =>
    match[1].toLowerCase(),
  )
  expect(locked.toSorted()).toEqual(
    used.map((one) => one.toLowerCase()).toSorted(),
  )
  for (const action of locked)
    expect(lock).toContain(`    '${action}':\n        ref:`)
})

// The shell of the step that moves release, run against a stub `gh`.

let dir
let advance

const GH = `#!/bin/sh
echo "$*" >> "$GH_LOG"
case "$*" in
  *"/commits/"*) echo "$FAKE_SHA" ;;
  *"/compare/"*) echo "$FAKE_STATUS" ;;
  *"/git/ref/heads/release"*)
    case "$FAKE_REF" in
      exists) echo '{}' ;;
      missing) echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;
      *) echo "gh: Server Error (HTTP 500)" >&2; exit 1 ;;
    esac ;;
  *"-X PATCH"*) if [ -n "$FAKE_PATCH_FAILS" ]; then echo "Update is not a fast forward" >&2; exit 1; fi ;;
  *"-X POST"*) ;;
esac
`

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'release-flow-'))
  await writeFile(join(dir, 'gh'), GH)
  await chmod(join(dir, 'gh'), 0o755)
  const workflow = await text('.github/workflows/tagpr.yml')
  const script = jobsOf(workflow)['advance-release-branch'].split('run: |\n')[1]
  // The block's lines are indented under `run: |`; drop that indent.
  advance = script
    .split('\n')
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n')
  await writeFile(join(dir, 'advance.sh'), advance)
})

afterAll(() => rm(dir, { recursive: true, force: true }))

function moveRelease(env) {
  const log = join(dir, `gh-${Math.random()}.log`)
  return new Promise((resolve) =>
    execFile(
      'bash',
      [join(dir, 'advance.sh')],
      {
        env: {
          PATH: `${dir}:${process.env.PATH}`,
          GITHUB_REPOSITORY: 'piconic-ai/slide',
          GH_LOG: log,
          TAG,
          FAKE_SHA: SHA,
          FAKE_STATUS: 'behind',
          FAKE_REF: 'exists',
          ...env,
        },
      },
      async (error, stdout, stderr) => {
        const calls = (await readFile(log, 'utf8').catch(() => ''))
          .split('\n')
          .filter(Boolean)
        resolve({
          code: error ? error.code : 0,
          output: stdout + stderr,
          calls,
        })
      },
    ),
  )
}

const writes = (calls) => calls.filter((call) => /-X (PATCH|POST)/.test(call))

test('REL-AC4: Given release exists and the tag is on main, When the step runs, Then release is patched to the tag commit with force off', async () => {
  const run = await moveRelease({})
  expect(run.code).toBe(0)
  expect(writes(run.calls)).toEqual([
    `api -X PATCH repos/piconic-ai/slide/git/refs/heads/release -f sha=${SHA} -F force=false`,
  ])
})

test('REL-AC4: Given the tagged commit is main itself, When the step runs, Then release is patched too', async () => {
  const run = await moveRelease({ FAKE_STATUS: 'identical' })
  expect(run.code).toBe(0)
  expect(writes(run.calls)).toHaveLength(1)
})

test('REL-AC4: Given release does not exist, When the step runs, Then it is created at the tag commit', async () => {
  const run = await moveRelease({ FAKE_REF: 'missing' })
  expect(run.code).toBe(0)
  expect(writes(run.calls)).toEqual([
    `api -X POST repos/piconic-ai/slide/git/refs -f ref=refs/heads/release -f sha=${SHA}`,
  ])
})

test('REL-AC4: Given release has gone its own way, When the step runs, Then the refused move fails the job and nothing else is tried', async () => {
  const run = await moveRelease({ FAKE_PATCH_FAILS: '1' })
  expect(run.code).not.toBe(0)
  expect(writes(run.calls)).toHaveLength(1)
})

test('REL-AC4: Given reading the release branch fails other than by not existing, When the step runs, Then it fails and writes nothing', async () => {
  const run = await moveRelease({ FAKE_REF: 'error' })
  expect(run.code).not.toBe(0)
  expect(writes(run.calls)).toEqual([])
})

test.each(['ahead', 'diverged', '', 'identical-ish'])(
  'REL-AC4: Given the tagged commit compares as %j with main, When the step runs, Then it fails and writes nothing',
  async (status) => {
    const run = await moveRelease({ FAKE_STATUS: status })
    expect(run.code).not.toBe(0)
    expect(writes(run.calls)).toEqual([])
  },
)

test.each([
  '',
  'v1',
  '1.2.3',
  'v1.2.3-rc1',
  'v1.2.3; echo hi',
  'main',
  'release',
  'v1.2.3\nv1.2.4',
])(
  'REL-AC4: Given the tag is %j, When the step runs, Then it fails before asking GitHub for anything',
  async (tag) => {
    const run = await moveRelease({ TAG: tag })
    expect(run.code).not.toBe(0)
    expect(run.calls).toEqual([])
  },
)

test.each(['', 'abc', 'A'.repeat(40), `${SHA}0`])(
  'REL-AC4: Given the tag resolves to %j, When the step runs, Then it fails and writes nothing',
  async (sha) => {
    const run = await moveRelease({ FAKE_SHA: sha })
    expect(run.code).not.toBe(0)
    expect(writes(run.calls)).toEqual([])
  },
)

// The step that starts CI on the release pull request, run against a stub `gh`.

const CI_GH = `#!/bin/sh
echo "$*" >> "$GH_LOG"
case "$*" in
  "pr list"*) printf '%s' "$FAKE_PRS" ;;
  "run list"*) printf '%s' "$FAKE_RUNS" ;;
esac
`
const RELEASE_BRANCH = 'tagpr-from-v0.3.0'
const HEAD = 'b'.repeat(40)
let ci

beforeAll(async () => {
  const workflow = await text('.github/workflows/tagpr.yml')
  const script = jobsOf(workflow)['run-ci-on-release-pr'].split('run: |\n')[1]
  ci = script
    .split('\n')
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n')
  await mkdir(join(dir, 'ci-bin'), { recursive: true })
  await writeFile(join(dir, 'ci-bin', 'gh'), CI_GH)
  await chmod(join(dir, 'ci-bin', 'gh'), 0o755)
  await writeFile(join(dir, 'ci.sh'), ci)
})

function startCi(env) {
  const log = join(dir, `ci-gh-${Math.random()}.log`)
  return new Promise((resolve) =>
    execFile(
      'bash',
      [join(dir, 'ci.sh')],
      {
        env: {
          PATH: `${join(dir, 'ci-bin')}:${process.env.PATH}`,
          GITHUB_REPOSITORY: 'piconic-ai/slide',
          GH_LOG: log,
          FAKE_PRS: `${RELEASE_BRANCH}\t${HEAD}\n`,
          FAKE_RUNS: '',
          ...env,
        },
      },
      async (error, stdout, stderr) => {
        const calls = (await readFile(log, 'utf8').catch(() => ''))
          .split('\n')
          .filter(Boolean)
        resolve({
          code: error ? error.code : 0,
          output: stdout + stderr,
          calls,
        })
      },
    ),
  )
}

const dispatches = (calls) =>
  calls.filter((call) => call.startsWith('workflow run'))

test('REL-AC13: Given the job that starts CI, When its condition and steps are read, Then it needs tagpr, skips a tag run, reads only, and interpolates no expression into the shell', async () => {
  const jobs = jobsOf(await text('.github/workflows/tagpr.yml'))
  const job = jobs['run-ci-on-release-pr']
  expect(job).toMatch(/^ {4}needs: tagpr$/m)
  expect(job).toMatch(/^ {4}if: needs\.tagpr\.outputs\.tag == ''$/m)
  expect(job).not.toContain('actions/checkout')
  const run = job.split('run: |\n')[1]
  expect(run).toBeTruthy()
  expect(run).not.toContain('${{')
  expect(run).toContain('gh workflow run ci.yml')
})

test('REL-AC13: Given the CI workflow, When its triggers are read, Then it can be started by hand', async () => {
  const ciWorkflow = await text('.github/workflows/ci.yml')
  expect(topLevel(ciWorkflow, 'on')).toMatch(/^ {2}workflow_dispatch:/m)
})

test('REL-AC13: Given an open release pull request whose head has no CI run, When the step runs, Then CI is started on its branch', async () => {
  const run = await startCi({})
  expect(run.code).toBe(0)
  expect(dispatches(run.calls)).toEqual([
    `workflow run ci.yml --repo piconic-ai/slide --ref ${RELEASE_BRANCH}`,
  ])
})

test('REL-AC13: Given CI has already run for the head, When the step runs, Then nothing is started again', async () => {
  const run = await startCi({ FAKE_RUNS: `${'c'.repeat(40)}\n${HEAD}\n` })
  expect(run.code).toBe(0)
  expect(dispatches(run.calls)).toEqual([])
})

test('REL-AC13: Given CI ran only for an older head, When the step runs, Then CI is started for the new one', async () => {
  const run = await startCi({ FAKE_RUNS: `${'c'.repeat(40)}\n` })
  expect(dispatches(run.calls)).toHaveLength(1)
})

test('REL-AC13: Given no open release pull request, When the step runs, Then it succeeds and starts nothing', async () => {
  const run = await startCi({ FAKE_PRS: '' })
  expect(run.code).toBe(0)
  expect(dispatches(run.calls)).toEqual([])
})

test.each([
  ['a branch not named like tagpr’s', `feature/x\t${HEAD}\n`],
  ['a branch with a command in its name', `tagpr-from-v1.0.0;id\t${HEAD}\n`],
  ['a head that is not a commit', `${RELEASE_BRANCH}\tnot-a-sha\n`],
])(
  'REL-AC13: Given %s, When the step runs, Then it fails and starts nothing',
  async (_label, prs) => {
    const run = await startCi({ FAKE_PRS: prs })
    expect(run.code).not.toBe(0)
    expect(dispatches(run.calls)).toEqual([])
  },
)
