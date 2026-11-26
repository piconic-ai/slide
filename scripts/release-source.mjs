// Which commit a release deploys, and whether it may. Pure: git and the
// network are handed in. docs/dev/release-flow.md (REL-AC11, REL-AC12).
//
// In Workers Builds the commit is the one it built. It is compared, when the
// network allows, with the head of `release` (a retried build of an old commit
// would move production back) and with `main` (only a commit on main may be
// released). Outside Workers Builds the checkout must be clean and be the
// commit pushed as `release`: nothing unpushed or uncommitted reaches
// production from a laptop.
//
// These checks catch mistakes. They do not stop a hostile commit on `release`,
// because the script is a file of that commit and could leave them out: what
// stops that is who may move `release` (the branch rules).

/** A full commit id. */
export const COMMIT = /^[0-9a-f]{40}$/

const REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+$/

/** `owner/name` as given, or null. */
export const parseRepo = (value) =>
  typeof value === 'string' &&
  REPO.test(value) &&
  !['.', '..'].includes(value.split('/')[1])
    ? value
    : null

const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'slide-release-deploy',
}

/** One GitHub API answer as JSON, or null when it is not one (private, limited, down). */
async function github(send, path) {
  try {
    const response = await send(`https://api.github.com${path}`, {
      method: 'GET',
      redirect: 'manual',
      headers: GITHUB_HEADERS,
    })
    return response.status === 200 ? await response.json() : null
  } catch {
    return null
  }
}

const stdoutOf = async (git, args) => {
  const answer = await git(args)
  return answer.code === 0 ? answer.stdout.trim() : null
}

/** The checks for a run outside Workers Builds: clean, and the pushed release. */
async function localSource(env, git) {
  const head = await stdoutOf(git, ['rev-parse', 'HEAD'])
  if (!head || !COMMIT.test(head)) return refuse('HEAD is not a commit')
  if (env.WORKERS_CI_COMMIT_SHA && env.WORKERS_CI_COMMIT_SHA !== head)
    return refuse('WORKERS_CI_COMMIT_SHA is not the commit checked out')
  const status = await stdoutOf(git, ['status', '--porcelain'])
  if (status === null) return refuse('git status failed')
  if (status !== '')
    return refuse('the working tree has changes that are not committed')
  const remote = await stdoutOf(git, [
    'ls-remote',
    'origin',
    'refs/heads/release',
  ])
  const pushed = remote?.split(/\s+/)[0]
  if (!pushed || !COMMIT.test(pushed))
    return refuse('could not read the pushed release branch')
  if (pushed !== head)
    return refuse('HEAD is not the commit pushed as origin/release')
  return { ok: true, commit: head, notes: [] }
}

/** The checks for Workers Builds: the commit built is the head of release, on main. */
async function builtSource(env, send, repo) {
  const commit = env.WORKERS_CI_COMMIT_SHA
  if (!commit || !COMMIT.test(commit))
    return refuse('WORKERS_CI_COMMIT_SHA is not a commit')
  const notes = []
  const ref = await github(send, `/repos/${repo}/git/ref/heads/release`)
  const head = ref?.object?.sha
  if (typeof head !== 'string' || !COMMIT.test(head))
    notes.push('the head of release was not checked: GitHub did not answer')
  else if (head !== commit)
    return refuse(
      'this build is not the latest commit of release; retry only the latest build',
    )
  const compared = await github(send, `/repos/${repo}/compare/main...${commit}`)
  if (compared?.status === 'identical' || compared?.status === 'behind') {
    // On main.
  } else if (typeof compared?.status === 'string')
    return refuse('this commit is not on main')
  else
    notes.push(
      'whether the commit is on main was not checked: GitHub did not answer',
    )
  return { ok: true, commit, notes }
}

const refuse = (reason) => ({ ok: false, reason })

/**
 * @param {{ env: Record<string, string | undefined>, outside: boolean,
 *   git: (args: string[]) => Promise<{ code: number, stdout: string }>,
 *   send: typeof fetch, repo: string }} input
 * @returns {Promise<{ ok: true, commit: string, notes: string[] } | { ok: false, reason: string }>}
 */
export const resolveSource = ({ env, outside, git, send, repo }) =>
  outside ? localSource(env, git) : builtSource(env, send, repo)
