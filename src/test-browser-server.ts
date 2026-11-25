import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import type { BrowserServer } from 'playwright'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  interface ProvidedContext {
    slideBrowserControl: string | null
  }
}

export default async function setup(project: TestProject) {
  project.provide('slideBrowserControl', null)
  const suites = project.vitest.state
    .getPaths()
    .filter((path) => path.endsWith('.browser.test.ts'))
  if (suites.length < 2 || (process.env.BROWSER ?? 'chromium') !== 'chromium')
    return

  // Vitest also runs global setup while listing or filtering tests. Launch only
  // when a suite requests a browser, and coalesce simultaneous worker requests.
  let browser: Promise<BrowserServer> | undefined
  async function launch() {
    const { chromium } = await import('playwright')
    const server = await chromium.launchServer({ host: '127.0.0.1' })
    server.once('close', () => {
      browser = undefined
    })
    return server
  }

  const path = '/' + randomUUID()
  const control = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== path) {
      response.writeHead(404).end()
      return
    }
    try {
      browser ??= launch()
      response.end((await browser).wsEndpoint())
    } catch (error) {
      browser = undefined
      response.writeHead(500).end(String(error))
    }
  })
  control.listen(0, '127.0.0.1')
  await once(control, 'listening')
  const address = control.address()
  if (!address || typeof address === 'string')
    throw new Error('Missing TCP address')
  project.provide(
    'slideBrowserControl',
    `http://127.0.0.1:${address.port}${path}`,
  )
  return async () => {
    await new Promise<void>((resolve, reject) =>
      control.close((error) => (error ? reject(error) : resolve())),
    )
    await (await browser)?.close()
  }
}
