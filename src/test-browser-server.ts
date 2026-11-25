import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  interface ProvidedContext {
    slideChromiumEndpoint: string | null
  }
}

export default async function setup(project: TestProject) {
  project.provide('slideChromiumEndpoint', null)
  const suites = project.vitest.state
    .getPaths()
    .filter((path) => path.endsWith('.browser.test.ts'))
  if (suites.length < 2 || (process.env.BROWSER ?? 'chromium') !== 'chromium')
    return

  const { chromium } = await import('playwright')
  const server = await chromium.launchServer({ host: '127.0.0.1' })
  project.provide('slideChromiumEndpoint', server.wsEndpoint())
  return () => server.close()
}
