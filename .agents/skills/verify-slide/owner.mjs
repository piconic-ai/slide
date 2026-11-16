// Signs a Playwright browser context in as the local owner, with the
// `__Host-slide_owner=...` cookie that scripts/demo-reactions.mjs prints.
// Local only: the session exists in the local D1, and the Worker has no route
// that bypasses authentication.

const SIGN_IN_PATH = '/__verify-slide-sign-in'

/**
 * Chromium and Firefox store the cookie from a response the test answers
 * itself. WebKit does not keep a Secure cookie for http://localhost; there the
 * cookie is added to each request instead, which is enough to read pages but
 * not to post forms (the fetched request loses its Origin header).
 */
export async function signInAsOwner(context, origin, cookie) {
  if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
    throw new Error('Local verification only')
  await context.route(`${origin}${SIGN_IN_PATH}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: 'signed in',
      headers: {
        'Set-Cookie': `${cookie}; Path=/; Secure; HttpOnly; SameSite=Lax`,
      },
    }),
  )
  const page = await context.newPage()
  await page.goto(`${origin}${SIGN_IN_PATH}`)
  await page.close()
  await context.unroute(`${origin}${SIGN_IN_PATH}`)
  if ((await context.cookies(origin)).length > 0) return 'cookie'
  await context.route(`${origin}/**`, async (route) => {
    const response = await route.fetch({
      headers: { ...route.request().headers(), cookie },
      maxRedirects: 0,
    })
    await route.fulfill({ response })
  })
  return 'header'
}
