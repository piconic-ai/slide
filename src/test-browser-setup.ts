import { vi } from 'vitest'

/**
 * What a test's `BROWSER` stand-in provides in place of a real browser: the
 * answer to a shot (a non-OK answer is a failed shot), and counts of how
 * many browsers were opened and closed.
 */
export type FakeBrowserBinding = {
  shoot: (options: { url: string }) => Response | Promise<Response>
  /** Opening a browser fails, as when the account's limit is reached. */
  launchFails?: boolean
  /** Closing the browser fails. */
  closeFails?: boolean
  opened?: number
  closed?: number
  /** The viewport, load options and screenshot options the browser was given. */
  seen?: {
    onDialog?: (dialog: { dismiss: () => Promise<void> }) => void
    viewport?: unknown
    goto?: unknown
    screenshot?: unknown
  }
}

// A real browser drawing a deck is checked after a deploy, and locally with
// verify-slide; tests stand in for it so they run anywhere.
vi.mock('@cloudflare/puppeteer', () => ({
  default: {
    launch: async (binding: FakeBrowserBinding) => {
      if (binding.launchFails) throw new Error('429 too many browsers')
      binding.opened = (binding.opened ?? 0) + 1
      let url = ''
      const seen: NonNullable<FakeBrowserBinding['seen']> = (binding.seen = {})
      return {
        newPage: async () => ({
          on: (event: string, handler: never) => {
            if (event === 'dialog') seen.onDialog = handler
          },
          setViewport: async (viewport: unknown) => {
            seen.viewport = viewport
          },
          goto: async (target: string, options: unknown) => {
            url = target
            seen.goto = options
          },
          screenshot: async (options: unknown) => {
            seen.screenshot = options
            const answer = await binding.shoot({ url })
            if (!answer.ok) throw new Error(`shot failed: ${answer.status}`)
            return new Uint8Array(await answer.arrayBuffer())
          },
        }),
        close: async () => {
          binding.closed = (binding.closed ?? 0) + 1
          if (binding.closeFails) throw new Error('session already gone')
        },
      }
    },
  },
}))
