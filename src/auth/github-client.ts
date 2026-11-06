import { githubUserSchema, tokenResponseSchema } from './github-oauth'

const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const USER_URL = 'https://api.github.com/user'

export type GitHubUser = Readonly<{ id: number; login: string }>
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

/** Exchanges an authorization code for a short-lived user token. */
export async function exchangeCode(
  app: AppCredentials,
  input: { code: string; redirectUri: string; verifier: string },
): Promise<string | null> {
  const parsed = tokenResponseSchema.safeParse(
    await fetchJson(TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
        code_verifier: input.verifier,
      }),
    }),
  )
  return parsed.success && 'access_token' in parsed.data
    ? parsed.data.access_token
    : null
}

export async function fetchUser(token: string): Promise<GitHubUser | null> {
  const parsed = githubUserSchema.safeParse(
    await fetchJson(USER_URL, { headers: apiHeaders(token) }),
  )
  return parsed.success ? parsed.data : null
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

/** Reads a repository as the user sees it, or null when it is not visible. */
export async function fetchRepository(
  token: string,
  fullName: string,
): Promise<unknown> {
  return fetchJson(`https://api.github.com/repos/${fullName}`, {
    headers: apiHeaders(token),
  })
}
