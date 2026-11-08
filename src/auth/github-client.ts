import type { z } from 'zod'
import type { githubUserSchema } from './github-oauth'

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

/** Reads a repository as the user sees it, or null when it is not visible. */
export async function fetchRepository(
  token: string,
  fullName: string,
): Promise<unknown> {
  return fetchJson(`https://api.github.com/repos/${fullName}`, {
    headers: apiHeaders(token),
  })
}
