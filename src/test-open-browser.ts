import { chromium, type BrowserType } from 'playwright'
import { inject } from 'vitest'

const CONNECT_MS = 20_000

/** Closing a connected browser releases only this suite's contexts and connection. */
export async function openTestBrowser(engine: BrowserType = chromium) {
  const control = inject('slideBrowserControl')
  if (!control || engine.name() !== 'chromium') return engine.launch()
  // Neither call has a time limit of its own, so a stuck shared browser would
  // leave the suite waiting; they fail instead, in time for the hook's limit.
  const response = await fetch(control, {
    method: 'POST',
    signal: AbortSignal.timeout(CONNECT_MS),
  })
  const endpoint = await response.text()
  if (!response.ok) throw new Error(endpoint)
  return engine.connect(endpoint, { timeout: CONNECT_MS })
}
