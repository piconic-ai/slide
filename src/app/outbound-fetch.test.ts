import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'

/** Every source file under src/, tests and test helpers left out. */
async function sources(dir = 'src'): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return sources(path)
      return /\.tsx?$/u.test(entry.name) &&
        !/\.test\.tsx?$|test-[^/]*\.ts$|\.d\.ts$/u.test(entry.name)
        ? [path]
        : []
    }),
  )
  return nested.flat()
}

const withoutComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|\s)\/\/ .*$/gmu, '')

// The global fetch called or passed on: `await fetch(`, `=> fetch(`,
// `= fetch`. A binding's or an entrypoint's own fetch (`env.ASSETS.fetch`,
// `override fetch(`) stays inside the Worker and is not one.
const GLOBAL_FETCH = /(?:\bawait|=>|=)\s*fetch\b/u

// Where each one goes (D-02). The upload status page's is a script in the
// author's browser that asks the same origin.
const OUTBOUND: Readonly<Record<string, string>> = {
  'src/alerts/discord-client.ts':
    'discord.com (the alert webhook, D-58; no personal data in the body)',
  'src/auth/turnstile-client.ts': 'challenges.cloudflare.com (Turnstile)',
  'src/feeds/luma-client.ts': 'api.lu.ma (Luma calendar feeds, D-60–D-69)',
  'src/mail/mail-client.ts': 'api.cloudflare.com (Email Sending)',
  'src/profile/gravatar-client.ts': 'gravatar.com (second scope)',
  'src/uploads/status-page.ts': 'the same origin, from the browser',
}

test('D-02: Given the source, When the global fetch is searched for, Then it is used only by the listed clients, the Luma client the one the third scope added', async () => {
  const found: string[] = []
  for (const path of await sources())
    if (GLOBAL_FETCH.test(withoutComments(await readFile(path, 'utf8'))))
      found.push(path)
  expect(found.sort()).toEqual(Object.keys(OUTBOUND).sort())
})
