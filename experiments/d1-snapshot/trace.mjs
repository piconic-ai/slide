import { relative } from 'node:path'
import { afterAll, expect, vi } from 'vitest'

const wrangler = vi.hoisted(() => ({ loaded: false, calls: 0 }))

vi.mock('wrangler', async (importOriginal) => {
  const actual = await importOriginal()
  wrangler.loaded = true
  return {
    ...actual,
    getPlatformProxy(...args) {
      wrangler.calls++
      return actual.getPlatformProxy(...args)
    },
  }
})

afterAll(() => {
  const file = relative(process.cwd(), expect.getState().testPath)
  console.log('SLIDE_WRANGLER', file, Number(wrangler.loaded), wrangler.calls)
})
