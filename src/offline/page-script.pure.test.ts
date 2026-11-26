import { describe, expect, test } from 'vitest'
import { pageScript } from '../pages/script'
import { STORED_AT_PLACEHOLDER } from './limits'

const VIEWER = 'https://slide.example'

describe('the page script, for offline reading', () => {
  test('F37-AC2: Given the script as the service sends it, Then it carries the marker once, with no time, so the version worker can set it', () => {
    const script = pageScript(VIEWER)
    expect(script.split(STORED_AT_PLACEHOLDER)).toHaveLength(2)
  })

  test('Given the script, Then the viewer is the only origin it tells and the only one it listens to', () => {
    const script = pageScript(VIEWER)
    for (const call of script.match(/postMessage\([^)]*\)/g) ?? [])
      expect(call).toContain(JSON.stringify(VIEWER))
    expect(script).toContain(`event.origin !== ${JSON.stringify(VIEWER)}`)
    expect(script).toContain('event.source !== parent')
  })

  test('Given the script, Then it tells a stored copy only when a time was put in', () => {
    expect(pageScript(VIEWER)).toContain('if (storedAt > 0)')
  })

  test("Given the script, Then it loads the service's own module and asks for nothing else on a request to keep", () => {
    const script = pageScript(VIEWER)
    expect(script).toContain('import("/_preview/offline.js")')
    expect(script).toContain('slide:offline-register')
  })

  test('Given two origins, Then the texts differ only in the origin', () => {
    expect(pageScript('https://a.example')).toBe(
      pageScript('https://b.example').replaceAll('b.example', 'a.example'),
    )
  })
})
