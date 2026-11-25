import { chromium, type BrowserType } from 'playwright'
import { inject } from 'vitest'

/** Closing a connected browser releases only this suite's contexts and connection. */
export async function openTestBrowser(engine: BrowserType = chromium) {
  const control = inject('slideBrowserControl')
  if (!control || engine.name() !== 'chromium') return engine.launch()
  const response = await fetch(control, { method: 'POST' })
  const endpoint = await response.text()
  if (!response.ok) throw new Error(endpoint)
  return engine.connect(endpoint)
}
