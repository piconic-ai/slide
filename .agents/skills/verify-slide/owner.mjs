// Signs a Playwright browser context in as the local owner, with the
// `__Host-slide_owner=...` cookie that scripts/demo-reactions.mjs prints.
// Local only: the session exists in the local D1, and the Worker has no route
// that bypasses authentication.

const SIGN_IN_PATH = '/__verify-slide-sign-in'

/**
 * Chromium and Firefox store the cookie from a response the test answers
 * itself. WebKit does not keep a Secure cookie for http://localhost; there the
 * cookie is added to each GET instead. That is enough to read pages; other
 * requests go out unsigned, so a form post there shows the sign-in page.
 */
export async function signInAsOwner(context, origin, cookie) {
  if (!cookie?.startsWith('__Host-slide_owner='))
    throw new Error('Pass the owner cookie that demo-reactions.mjs prints')
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
    if (route.request().method() !== 'GET') return route.continue()
    // Redirects are followed here: a route cannot answer with one.
    const response = await route.fetch({
      headers: { ...route.request().headers(), cookie },
    })
    await route.fulfill({ response })
  })
  return 'header'
}
