import type { Context } from 'hono'

const acceptsJson = (c: Context) =>
  c.req
    .header('Accept')
    ?.split(',')
    .some(
      (type) =>
        type.split(';', 1)[0].trim().toLowerCase() === 'application/json',
    )

const noStore = { 'Cache-Control': 'no-store' }

export function signedOut(
  c: Context,
  fallback: () => Response | Promise<Response>,
) {
  return acceptsJson(c)
    ? c.json({ error: 'sign_in' }, 401, noStore)
    : fallback()
}

export async function afterChange(
  c: Context,
  back: string,
  readState: () => Promise<{ following: boolean } | { muted: boolean }>,
) {
  if (!acceptsJson(c)) return c.redirect(back, 303)
  return c.json(await readState(), 200, noStore)
}
