import { expect, test } from 'vitest'
import { parseRepo, resolveSource } from './release-source.mjs'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const repo = 'piconic-ai/slide'

/** A `git` that answers by its arguments; `calls` records what was asked. */
function fakeGit({ head = A, status = '', remote = A, fails = [] } = {}) {
  const calls = []
  const git = async (args) => {
    calls.push(args.join(' '))
    const name = args[0]
    if (fails.includes(name)) return { code: 1, stdout: '' }
    if (name === 'rev-parse') return { code: 0, stdout: `${head}\n` }
    if (name === 'status') return { code: 0, stdout: status }
    if (name === 'ls-remote')
      return {
        code: 0,
        stdout: remote === null ? '' : `${remote}\trefs/heads/release\n`,
      }
    throw new Error(`unexpected git ${args}`)
  }
  return { git, calls }
}

/** A `fetch` for the GitHub API; `release` and `compare` are what it answers. */
function fakeGithub({ release = A, compare = 'behind', down = false } = {}) {
  const asked = []
  const send = async (url) => {
    asked.push(url)
    if (down) throw new Error('offline')
    if (url.endsWith('/git/ref/heads/release'))
      return release === null
        ? new Response('{}', { status: 404 })
        : Response.json({ object: { sha: release } })
    if (url.includes('/compare/main...'))
      return compare === null
        ? new Response('{}', { status: 403 })
        : Response.json({ status: compare })
    throw new Error(`unexpected ${url}`)
  }
  return { send, asked }
}

const built = (env, github = fakeGithub()) =>
  resolveSource({
    env: { WORKERS_CI_COMMIT_SHA: A, ...env },
    outside: false,
    git: fakeGit().git,
    send: github.send,
    repo,
  })

const outside = (env = {}, gitOptions = {}) => {
  const git = fakeGit(gitOptions)
  return resolveSource({
    env,
    outside: true,
    git: git.git,
    send: fakeGithub({ down: true }).send,
    repo,
  }).then((result) => ({ result, calls: git.calls }))
}

test('REL-AC11: Given Workers Builds built the head of release and it is on main, When the source is resolved, Then the commit is accepted with nothing unchecked', async () => {
  const result = await built({})
  expect(result).toEqual({ ok: true, commit: A, notes: [] })
})

test.each(['identical', 'behind'])(
  'REL-AC11: Given the commit compares %s with main, When the source is resolved, Then it is accepted',
  async (compare) => {
    expect((await built({}, fakeGithub({ compare }))).ok).toBe(true)
  },
)

test('REL-AC11: Given a retried build of an old commit, When the source is resolved, Then it is refused because release has moved on', async () => {
  const result = await built({}, fakeGithub({ release: B }))
  expect(result).toMatchObject({ ok: false })
  expect(result.reason).toContain('latest commit of release')
})

test.each(['ahead', 'diverged'])(
  'REL-AC11: Given the commit compares %s with main, When the source is resolved, Then it is refused',
  async (compare) => {
    const result = await built({}, fakeGithub({ compare }))
    expect(result).toMatchObject({ ok: false })
    expect(result.reason).toContain('not on main')
  },
)

test('REL-AC11: Given GitHub does not answer, When the source is resolved, Then the build goes on and says what it did not check', async () => {
  for (const github of [
    fakeGithub({ down: true }),
    fakeGithub({ release: null, compare: null }),
  ]) {
    const result = await built({}, github)
    expect(result.ok).toBe(true)
    expect(result.notes).toEqual([
      expect.stringContaining('head of release was not checked'),
      expect.stringContaining('on main was not checked'),
    ])
  }
})

test('REL-AC11: Given GitHub answers something that is not a commit, When the source is resolved, Then it is treated as no answer, not as a match', async () => {
  const send = async (url) =>
    url.endsWith('/heads/release')
      ? Response.json({ object: { sha: 'not-a-sha' } })
      : Response.json({ status: 42 })
  const result = await resolveSource({
    env: { WORKERS_CI_COMMIT_SHA: A },
    outside: false,
    git: fakeGit().git,
    send,
    repo,
  })
  expect(result.ok).toBe(true)
  expect(result.notes).toHaveLength(2)
})

test.each([undefined, '', 'abc', 'A'.repeat(40), `${A}0`, `${A}\n--help`])(
  'REL-AC11: Given WORKERS_CI_COMMIT_SHA is %j, When the source is resolved, Then it is refused and GitHub is not asked',
  async (sha) => {
    const github = fakeGithub()
    const result = await built({ WORKERS_CI_COMMIT_SHA: sha }, github)
    expect(result).toMatchObject({ ok: false })
    expect(github.asked).toEqual([])
  },
)

test('REL-AC12: Given a clean checkout whose HEAD is the pushed release, When it is resolved outside Workers Builds, Then HEAD is the commit', async () => {
  const { result, calls } = await outside()
  expect(result).toEqual({ ok: true, commit: A, notes: [] })
  expect(calls).toContain('status --porcelain')
  expect(calls).toContain('ls-remote origin refs/heads/release')
})

test('REL-AC12: Given WORKERS_CI_COMMIT_SHA is absent, When it is resolved outside Workers Builds, Then git rev-parse HEAD names the commit', async () => {
  const { result, calls } = await outside({}, { head: B, remote: B })
  expect(result.commit).toBe(B)
  expect(calls[0]).toBe('rev-parse HEAD')
})

test.each([
  ['changes are not committed', { status: ' M src/app/routes.tsx\n' }],
  ['a file is untracked', { status: '?? notes.txt\n' }],
  ['HEAD is not the pushed release', { remote: B }],
  ['the release branch is not pushed', { remote: null }],
  ['the remote answer is not a commit', { remote: 'garbage' }],
  ['HEAD is not a commit', { head: 'refs/heads/x' }],
  ['git status fails', { fails: ['status'] }],
  ['git rev-parse fails', { fails: ['rev-parse'] }],
  ['git ls-remote fails', { fails: ['ls-remote'] }],
])(
  'REL-AC12: Given %s, When it is resolved outside Workers Builds, Then it is refused',
  async (_name, options) => {
    const { result } = await outside({}, options)
    expect(result).toMatchObject({ ok: false })
  },
)

test('REL-AC12: Given the Workers Builds commit differs from the checkout, When it is resolved outside Workers Builds, Then it is refused', async () => {
  const { result } = await outside({ WORKERS_CI_COMMIT_SHA: B })
  expect(result).toMatchObject({ ok: false })
  expect(result.reason).toContain('not the commit checked out')
})

test.each([
  ['piconic-ai/slide', 'piconic-ai/slide'],
  ['a.b/c_d-e', 'a.b/c_d-e'],
  ['slide', null],
  ['a/b/c', null],
  ['a/b?x=1', null],
  ['../x', null],
  ['a/..', null],
  ['a/.', null],
  ['a b/c', null],
  ['', null],
  [undefined, null],
])(
  'REL-AC11: Given the repository %j, When it is parsed, Then it is %j',
  (value, expected) => {
    expect(parseRepo(value)).toBe(expected)
  },
)
