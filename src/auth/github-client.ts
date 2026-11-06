import { githubUserSchema, tokenResponseSchema } from './github-oauth'

const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const USER_URL = 'https://api.github.com/user'

export type GitHubUser = Readonly<{ id: number; login: string }>

/** Exchanges an authorization code for a short-lived user token. */
export async function exchangeCode(input: {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
  verifier: string
}): Promise<string | null> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
    }),
  })
  if (!response.ok) return null
  const parsed = tokenResponseSchema.safeParse(await response.json())
  return parsed.success && 'access_token' in parsed.data
    ? parsed.data.access_token
    : null
}

export async function fetchUser(token: string): Promise<GitHubUser | null> {
  const response = await fetch(USER_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'slide',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok) return null
  const parsed = githubUserSchema.safeParse(await response.json())
  return parsed.success ? parsed.data : null
}
