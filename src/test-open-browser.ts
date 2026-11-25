import { chromium, type BrowserType } from 'playwright'
import { inject } from 'vitest'

/** Closing a connected browser releases only this suite's contexts and connection. */
export function openTestBrowser(engine: BrowserType = chromium) {
  const endpoint = inject('slideChromiumEndpoint')
  if (endpoint && engine.name() === 'chromium') return engine.connect(endpoint)
  return engine.launch()
}
