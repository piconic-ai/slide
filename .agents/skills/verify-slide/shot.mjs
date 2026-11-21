// Opens one page of a local Worker in a browser, saves a screenshot, and prints
// what a reader would notice: the status, the title, console errors, and the
// requests that failed. Local only.
//
//   node .agents/skills/verify-slide/shot.mjs <url> <png> [owner cookie]
//
// BROWSER=firefox or webkit picks another engine; SLIDE_LOCALE=en-US another
// language; SLIDE_WIDTH the viewport width (default 1280). The owner cookie is the
// `__Host-slide_owner=...` value that scripts/demo-citations.mjs prints.
import { chromium, firefox, webkit } from 'playwright'
import { signInAsOwner } from './owner.mjs'

const [address, file, cookie] = process.argv.slice(2)
if (!address || !file) throw new Error('Name a URL and a PNG file')
const url = new URL(address)
if (!['localhost', '127.0.0.1'].includes(url.hostname))
  throw new Error('Local verification only')

const engines = { chromium, firefox, webkit }
const engine = engines[process.env.BROWSER ?? 'chromium']
if (!engine) throw new Error('BROWSER must be chromium, firefox or webkit')

const browser = await engine.launch()
try {
  const context = await browser.newContext({
    viewport: { width: Number(process.env.SLIDE_WIDTH ?? 1280), height: 800 },
    // The service picks its language from the browser; engines differ.
    locale: process.env.SLIDE_LOCALE ?? 'ja-JP',
  })
  if (cookie) await signInAsOwner(context, url.origin, cookie)
  const page = await context.newPage()
  const errors = []
  const failed = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('requestfailed', (request) =>
    failed.push(`${request.failure()?.errorText ?? 'failed'} ${request.url()}`),
  )
  page.on('response', (response) => {
    if (response.status() >= 400)
      failed.push(`${response.status()} ${response.url()}`)
  })
  const response = await page.goto(url.href, { waitUntil: 'networkidle' })
  await page.screenshot({ path: file, fullPage: true })
  console.log(
    JSON.stringify(
      {
        status: response?.status() ?? null,
        url: page.url(),
        title: await page.title(),
        consoleErrors: errors,
        failedRequests: failed,
        screenshot: file,
      },
      null,
      2,
    ),
  )
} finally {
  await browser.close()
}
