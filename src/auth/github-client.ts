import { z } from 'zod'
import { githubUserSchema } from './github-oauth'

export type GitHubUser = Readonly<z.infer<typeof githubUserSchema>>
type AppCredentials = Readonly<{ clientId: string; clientSecret: string }>

const apiHeaders = (token: string) => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'User-Agent': 'slide',
  'X-GitHub-Api-Version': '2022-11-28',
})

/** Reads a JSON body, treating network and parse failures as no result. */
async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  try {
    const response = await fetch(url, init)
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

/** Revokes a user token at GitHub once the request no longer needs it. */
export async function revokeToken(
  app: AppCredentials,
  token: string,
): Promise<void> {
  try {
    await fetch(`https://api.github.com/applications/${app.clientId}/token`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Basic ${btoa(`${app.clientId}:${app.clientSecret}`)}`,
        'User-Agent': 'slide',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ access_token: token }),
    })
  } catch {
    // Revocation is best effort; the token also expires on its own.
  }
}

const SPONSORS_TIMEOUT_MS = 3000
const sponsorsAnswer = z.object({
  data: z.object({ viewer: z.object({ hasSponsorsListing: z.boolean() }) }),
})

/**
 * Whether the token's user has a GitHub Sponsors page, or null when GitHub
 * does not say. The REST profile does not carry this, hence GraphQL.
 */
export async function fetchHasSponsorsListing(
  token: string,
): Promise<boolean | null> {
  const answer = sponsorsAnswer.safeParse(
    await fetchJson('https://api.github.com/graphql', {
      method: 'POST',
      headers: { ...apiHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ viewer { hasSponsorsListing } }' }),
      // Sign-in waits for this answer, so it must not wait long.
      signal: AbortSignal.timeout(SPONSORS_TIMEOUT_MS),
    }),
  )
  return answer.success ? answer.data.data.viewer.hasSponsorsListing : null
}

const FOLLOWERS_PER_PAGE = 100
const MAX_FOLLOWER_PAGES = 5
const followerPage = z
  .array(githubUserSchema.pick({ id: true }))
  .max(FOLLOWERS_PER_PAGE)

export async function* fetchFollowerIds(
  token: string,
  login: string,
  signal: AbortSignal,
): AsyncGenerator<string[]> {
  const url = `https://api.github.com/users/${encodeURIComponent(login)}/followers`
  for (let page = 1; page <= MAX_FOLLOWER_PAGES; page++) {
    signal.throwIfAborted()
    const response = await fetch(
      `${url}?per_page=${FOLLOWERS_PER_PAGE}&page=${page}`,
      {
        headers: apiHeaders(token),
        signal,
      },
    )
    if (response.status !== 200) {
      await response.body?.cancel()
      throw new Error(`GitHub followers request returned ${response.status}`)
    }
    const followers = followerPage.parse(await response.json())
    yield followers.map(({ id }) => String(id))
    if (followers.length < FOLLOWERS_PER_PAGE) return
  }
}

/** Reads a repository as the user sees it, or null when it is not visible. */
export async function fetchRepository(
  token: string,
  fullName: string,
): Promise<unknown> {
  return fetchJson(`https://api.github.com/repos/${fullName}`, {
    headers: apiHeaders(token),
  })
}
