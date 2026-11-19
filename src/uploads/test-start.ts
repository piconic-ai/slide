import { testEnv } from '../publication/test-support'
import { deckUploadsApi } from './api'

/**
 * Starts an upload of a new version as a signed-in author's browser does:
 * with the session cookie, from the service's own origin, as JSON. `cookie`
 * comes from `signIn` with the same environment.
 */
export function startAsAuthor(
  env: Env,
  cookie: string,
  deck: string,
  body: Readonly<Record<string, unknown>>,
) {
  return deckUploadsApi.request(
    `http://localhost/${deck}/uploads`,
    {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: 'http://localhost',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ attempt: 'test-attempt-0123456789', ...body }),
    },
    testEnv(env),
  )
}
