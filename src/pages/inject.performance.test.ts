import { describe, expect, it } from 'vitest'
import { injectIntoBytes, MAX_INJECTED_BYTES } from './inject'

const SCRIPT = 'tell()'

describe('injectIntoBytes', () => {
  const bytes = (text: string) => new TextEncoder().encode(text)

  // A served index.html is read with this scan on every full answer.
  it.each([
    ['tags that never close', '<a '],
    ['tags that open a quote and never close', '<a "'],
    ['comments that never close', '<!--'],
    ['scripts that never close', '<script>'],
    ['templates that never close', '<template>'],
    [
      'meta tags with unclosed values',
      `<meta http-equiv=content-security-policy content="`,
    ],
    ['bare less-than signs', '<'],
  ])(
    'F03-AC153: Given the largest file full of %s, When it is served, Then the answer comes in time linear in its size',
    (_, unit) => {
      const start = '<!doctype html><html><head>'
      const html =
        start + unit.repeat((MAX_INJECTED_BYTES - start.length) / unit.length)
      const started = performance.now()
      injectIntoBytes(bytes(html.slice(0, MAX_INJECTED_BYTES)), SCRIPT)
      expect(performance.now() - started).toBeLessThan(10000)
    },
    30000,
  )
})

describe('meta policies at scale', () => {
  const meta = `<meta http-equiv="Content-Security-Policy" content="script-src 'none'">`
  const withMetas = (count: number) =>
    `<!doctype html><html><head>${meta.repeat(count)}<title>t</title></head>`

  // However many policies a file declares, the script goes in: a served
  // top page is read on every full answer.
  it('F03-AC153: Given the largest file full of meta policies, When it is served, Then the script goes in, in time linear in its size', () => {
    const count = Math.floor((MAX_INJECTED_BYTES - 100) / meta.length)
    const html = new TextEncoder().encode(withMetas(count))
    const started = performance.now()

    expect(injectIntoBytes(html, SCRIPT)?.length).toBe(
      html.length + `<script>${SCRIPT}</script>`.length,
    )

    expect(performance.now() - started).toBeLessThan(3000)
  }, 30000)
})
