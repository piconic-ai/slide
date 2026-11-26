import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'

// These run scripts/release-deploy.mjs as a real process. wrangler is a stub
// that records how it was called, and `fetch` is replaced by a preloaded
// module that answers like a healthy release and records every Discord post:
// nothing here reaches Cloudflare, Discord or the production site.

const WEBHOOK =
  'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123'
const TOKEN = 'cf-token-0123456789'

let dir
let stub
let gitStub
let preload

const STUB = `#!/bin/sh
echo "$*" >> "$STUB_LOG"
echo "webhook-in-env=\${DISCORD_WEBHOOK_URL:+yes}" >> "$STUB_LOG"
echo "token $CLOUDFLARE_API_TOKEN" >&2
case "$STUB_FAIL" in
  "$1 $2"|"$1") exit 1 ;;
esac
if [ "$1 $2" = "d1 time-travel" ]; then echo '{"bookmark":"bk-test-1"}'; fi
`

const GIT_STUB = `#!/bin/sh
echo "$*" >> "$GIT_LOG"
case "$1" in
  rev-parse) echo "$GIT_HEAD" ;;
  status) printf '%s' "$GIT_STATUS" ;;
  ls-remote) printf '%s\\trefs/heads/release\\n' "$GIT_REMOTE" ;;
esac
`

const COMMIT = '0123456789abcdef0123456789abcdef01234567'

const PRELOAD = `
import { appendFileSync } from 'node:fs'
const html = (body, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html' } })
globalThis.fetch = async (url, init) => {
  const u = String(url)
  if (u.startsWith('https://discord.com/')) {
    appendFileSync(process.env.FAKE_POSTS, init.body + '\\n')
    return new Response(null, { status: 204 })
  }
  if (u.startsWith('https://api.github.com/')) {
    appendFileSync(process.env.FAKE_GITHUB, u + '\\n')
    if (process.env.FAKE_GITHUB_DOWN) throw new Error('offline')
    if (u.endsWith('/git/ref/heads/release'))
      return Response.json({ object: { sha: process.env.FAKE_RELEASE_HEAD } })
    return Response.json({ status: process.env.FAKE_COMPARE ?? 'behind' })
  }
  appendFileSync(process.env.FAKE_ASKED, u + '\\n')
  const { host, pathname } = new URL(u)
  if (process.env.FAKE_BAD && pathname === process.env.FAKE_BAD) return html('x', 500)
  if (host === 'admin.slide.community')
    return new Response(null, {
      status: 302,
      headers: { location: 'https://piconic-ai.cloudflareaccess.com/login' },
    })
  if (host === 'www.slideusercontent.com') return html('', 404)
  if (host.startsWith('d-00000000')) return html('', 404)
  if (host.startsWith('d-')) return html('slide')
  if (pathname === '/robots.txt')
    return new Response('User-agent: *', { headers: { 'content-type': 'text/plain' } })
  if (pathname === '/api/slides') return new Response('{}', { status: 401 })
  if (pathname === '/api/public/slides') return Response.json([{ href: '/@a/b' }])
  if (pathname === '/@a/b') return html('<iframe src="https://d-1.slideusercontent.com/"></iframe>')
  return html('<p>ok</p>')
}
`

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'release-deploy-'))
  stub = join(dir, 'wrangler-stub')
  preload = join(dir, 'fake-fetch.mjs')
  gitStub = join(dir, 'git-stub')
  await writeFile(stub, STUB)
  await chmod(stub, 0o755)
  await writeFile(gitStub, GIT_STUB)
  await chmod(gitStub, 0o755)
  await writeFile(preload, PRELOAD)
})

afterAll(() => rm(dir, { recursive: true, force: true }))

/** Runs the script; resolves to its exit code, its output and what the fakes saw. */
async function release({ env = {}, args = [] } = {}) {
  const files = {
    STUB_LOG: join(dir, `calls-${Math.random()}.log`),
    FAKE_POSTS: join(dir, `posts-${Math.random()}.log`),
    FAKE_ASKED: join(dir, `asked-${Math.random()}.log`),
    FAKE_GITHUB: join(dir, `github-${Math.random()}.log`),
    GIT_LOG: join(dir, `git-${Math.random()}.log`),
  }
  const read = (path) => readFile(path, 'utf8').catch(() => '')
  const result = await new Promise((resolve) =>
    execFile(
      process.execPath,
      [
        '--import',
        preload,
        'scripts/release-deploy.mjs',
        '--wrangler',
        stub,
        '--git',
        gitStub,
        ...args,
      ],
      {
        env: {
          PATH: process.env.PATH,
          WORKERS_CI: '1',
          WORKERS_CI_BRANCH: 'release',
          WORKERS_CI_COMMIT_SHA: COMMIT,
          FAKE_RELEASE_HEAD: COMMIT,
          GIT_HEAD: COMMIT,
          GIT_REMOTE: COMMIT,
          GIT_STATUS: '',
          CLOUDFLARE_API_TOKEN: TOKEN,
          DISCORD_WEBHOOK_URL: WEBHOOK,
          ...files,
          ...env,
        },
      },
      (error, stdout, stderr) =>
        resolve({ code: error ? error.code : 0, stdout, stderr }),
    ),
  )
  return {
    ...result,
    output: result.stdout + result.stderr,
    calls: (await read(files.STUB_LOG))
      .split('\n')
      .filter((line) => line && !line.startsWith('webhook-in-env')),
    stubEnvLines: (await read(files.STUB_LOG))
      .split('\n')
      .filter((line) => line.startsWith('webhook-in-env')),
    posts: (await read(files.FAKE_POSTS))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
    asked: (await read(files.FAKE_ASKED)).split('\n').filter(Boolean),
    github: (await read(files.FAKE_GITHUB)).split('\n').filter(Boolean),
    git: (await read(files.GIT_LOG)).split('\n').filter(Boolean),
  }
}

test('REL-AC6: Given Workers Builds building the release branch with a healthy site, When the script runs, Then wrangler is called in order, the checks run, nothing is told and it exits 0', async () => {
  const run = await release()
  expect(run.code).toBe(0)
  expect(run.calls).toEqual([
    'd1 time-travel info slide --json',
    'd1 migrations apply slide --remote',
    'deploy',
  ])
  expect(run.asked.length).toBeGreaterThan(10)
  expect(run.posts).toEqual([])
  expect(run.output).toContain('the release is checked')
})

test('REL-AC7: Given the migrations fail, When the script runs, Then deploy is never called, one notice is posted and it exits 1', async () => {
  const run = await release({ env: { STUB_FAIL: 'd1 migrations' } })
  expect(run.code).toBe(1)
  expect(run.calls).toEqual([
    'd1 time-travel info slide --json',
    'd1 migrations apply slide --remote',
  ])
  expect(run.asked).toEqual([])
  expect(run.posts).toHaveLength(1)
  expect(run.posts[0].content).toContain('反映が途中で止まりました')
  expect(run.posts[0].content).toContain('migration の適用')
})

test('REL-AC8: Given a page fails after the deploy, When the script runs, Then it exits 1 and the notice names that check', async () => {
  const run = await release({ env: { FAKE_BAD: '/help' } })
  expect(run.code).toBe(1)
  expect(run.calls).toContain('deploy')
  expect(run.posts).toHaveLength(1)
  expect(run.posts[0].content).toContain('反映の後の確認に失敗しました')
  expect(run.posts[0].content).toContain('確認: help')
  expect(run.output).toContain('failed  help: status 500')
})

test('REL-AC7: Given no webhook is set, When a step fails, Then nothing is posted, the log says so and the exit code is still 1', async () => {
  const run = await release({
    env: { DISCORD_WEBHOOK_URL: '', STUB_FAIL: 'deploy' },
  })
  expect(run.code).toBe(1)
  expect(run.posts).toEqual([])
  expect(run.output).toContain('no usable Discord webhook')
})

test('REL-AC7: Given a webhook and a token, When the script runs and fails, Then neither appears in the output and wrangler does not receive the webhook', async () => {
  const run = await release({ env: { STUB_FAIL: 'deploy' } })
  expect(run.output).not.toContain(WEBHOOK)
  expect(run.output).not.toContain('abcdefghijklmnopqrstuvwxyz0123')
  expect(run.output).not.toContain(TOKEN)
  expect(run.output).toContain('token [redacted]')
  expect(run.stubEnvLines.every((line) => line === 'webhook-in-env=')).toBe(
    true,
  )
  expect(JSON.stringify(run.posts)).not.toContain(TOKEN)
})

test('REL-AC6: Given the wrangler binary is missing, When the script runs, Then it stops at the first step with exit 1 and tells Discord', async () => {
  const run = await release({ args: ['--wrangler', join(dir, 'absent')] })
  expect(run.code).toBe(1)
  expect(run.posts).toHaveLength(1)
  expect(run.posts[0].content).toContain('Time Travel の位置の記録')
})

test.each([
  ['outside Workers Builds', { WORKERS_CI: '' }],
  ['a build of the main branch', { WORKERS_CI_BRANCH: 'main' }],
  ['a build of a preview branch', { WORKERS_CI_BRANCH: 'feat/x' }],
])(
  'REL-AC10: Given %s, When the script runs, Then it refuses with exit 2 before running wrangler, checking or posting',
  async (_name, env) => {
    const run = await release({ env })
    expect(run.code).toBe(2)
    expect(run.calls).toEqual([])
    expect(run.asked).toEqual([])
    expect(run.posts).toEqual([])
    expect(run.output).toContain('refused')
  },
)

test('REL-AC12: Given the flag and a clean checkout that is the pushed release, When the script runs outside Workers Builds, Then it goes on with HEAD as the commit', async () => {
  const run = await release({
    env: { WORKERS_CI: '', WORKERS_CI_BRANCH: '', WORKERS_CI_COMMIT_SHA: '' },
    args: ['--allow-outside-ci'],
  })
  expect(run.code).toBe(0)
  expect(run.git).toEqual([
    'rev-parse HEAD',
    'status --porcelain',
    'ls-remote origin refs/heads/release',
  ])
  expect(run.github).toEqual([])
})

test.each([
  ['changes are not committed', { GIT_STATUS: ' M src/a.ts\n' }],
  ['HEAD is not the pushed release', { GIT_REMOTE: 'b'.repeat(40) }],
])(
  'REL-AC12: Given the flag and %s, When the script runs outside Workers Builds, Then it refuses with exit 2 before running wrangler',
  async (_name, env) => {
    const run = await release({
      env: { WORKERS_CI: '', WORKERS_CI_COMMIT_SHA: '', ...env },
      args: ['--allow-outside-ci'],
    })
    expect(run.code).toBe(2)
    expect(run.calls).toEqual([])
    expect(run.asked).toEqual([])
    expect(run.output).toContain('refused')
  },
)

test('REL-AC10: Given the flag in a Workers Builds build of another branch, When the script runs, Then it still refuses', async () => {
  const run = await release({
    env: { WORKERS_CI_BRANCH: 'main' },
    args: ['--allow-outside-ci'],
  })
  expect(run.code).toBe(2)
  expect(run.calls).toEqual([])
})

test('REL-AC11: Given a retried build of an old commit, When the script runs, Then it refuses with exit 2 before running wrangler', async () => {
  const run = await release({ env: { FAKE_RELEASE_HEAD: 'b'.repeat(40) } })
  expect(run.code).toBe(2)
  expect(run.calls).toEqual([])
  expect(run.output).toContain('latest commit of release')
})

test('REL-AC11: Given the commit is not on main, When the script runs, Then it refuses with exit 2 before running wrangler', async () => {
  const run = await release({ env: { FAKE_COMPARE: 'diverged' } })
  expect(run.code).toBe(2)
  expect(run.calls).toEqual([])
})

test('REL-AC11: Given GitHub cannot be reached from the build, When the script runs, Then it goes on and says what it did not check', async () => {
  const run = await release({ env: { FAKE_GITHUB_DOWN: '1' } })
  expect(run.code).toBe(0)
  expect(run.output).toContain('note: the head of release was not checked')
})

test.each([['not-a-sha'], ['']])(
  'REL-AC11: Given the commit built is %j, When the script runs, Then it refuses',
  async (sha) => {
    const run = await release({ env: { WORKERS_CI_COMMIT_SHA: sha } })
    expect(run.code).toBe(2)
    expect(run.calls).toEqual([])
  },
)

test.each([
  ['an unknown argument', ['stray']],
  ['an origin that is not an origin', ['--site', 'https://slide.community/x']],
  ['an http origin', ['--admin-origin', 'http://admin.slide.community']],
])(
  'REL-AC9: Given %s, When the script runs, Then it exits 2 and runs nothing',
  async (_name, args) => {
    const run = await release({ args })
    expect(run.code).toBe(2)
    expect(run.calls).toEqual([])
  },
)

test('REL-AC9: Given origins are passed, When the script runs, Then the checks ask those origins and not the ones of wrangler.jsonc', async () => {
  const run = await release({
    args: [
      '--site',
      'https://slide.example',
      '--admin-origin',
      'https://admin.slide.example',
    ],
  })
  const hosts = new Set(run.asked.map((url) => new URL(url).host))
  expect(hosts.has('slide.example')).toBe(true)
  expect(hosts.has('admin.slide.example')).toBe(true)
  expect(hosts.has('slide.community')).toBe(false)
})

test('REL-AC8: Given the checks are run by hand against healthy origins, When the script runs, Then it prints every check and exits 0', async () => {
  const run = await handCheck([])
  expect(run.code).toBe(0)
  expect(run.output).toContain('ok      top page: status 200')
  expect(run.output).not.toContain('failed')
})

test('REL-AC8: Given a page fails, When the checks are run by hand, Then the failed item is named and the exit code is 1', async () => {
  const run = await handCheck([], { FAKE_BAD: '/login' })
  expect(run.code).toBe(1)
  expect(run.output).toContain('failed: login')
})

test.each([
  ['an origin that is not an origin', ['--site', 'slide.community']],
  ['an unknown argument', ['stray']],
  ['the deploy script flag', ['--allow-outside-ci']],
])(
  'REL-AC9: Given %s, When the checks are run by hand, Then it exits 2 and asks nothing',
  async (_name, args) => {
    const run = await handCheck(args)
    expect(run.code).toBe(2)
    expect(run.asked).toEqual([])
  },
)

/** Runs the hand-run check with the same fake fetch as the deploy tests. */
async function handCheck(args, env = {}) {
  const asked = join(dir, `hand-asked-${Math.random()}.log`)
  const result = await new Promise((resolve) =>
    execFile(
      process.execPath,
      ['--import', preload, 'scripts/post-deploy-check.mjs', ...args],
      {
        env: {
          PATH: process.env.PATH,
          FAKE_POSTS: join(dir, 'unused.log'),
          FAKE_ASKED: asked,
          ...env,
        },
      },
      (error, stdout, stderr) =>
        resolve({ code: error ? error.code : 0, output: stdout + stderr }),
    ),
  )
  const seen = await readFile(asked, 'utf8').catch(() => '')
  return { ...result, asked: seen.split('\n').filter(Boolean) }
}
