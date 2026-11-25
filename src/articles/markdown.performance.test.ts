import { describe, expect, test } from 'vitest'
import { onlyAllowed, renderArticle } from './markdown'

const render = (source: string) =>
  renderArticle(source, {
    origin: 'https://slide.example',
    embeds: new Map(),
    lang: 'ja',
  })

describe('F26-AC10: awkward inputs stay quick and safe', () => {
  const limit = 50_000
  test.each([
    ['many open brackets', '['.repeat(limit)],
    ['many open parentheses', '[a]('.repeat(limit / 4)],
    ['many backticks', '`'.repeat(limit)],
    ['deep quotes', '> '.repeat(limit / 2) + 'x'],
    [
      'deep lists',
      Array.from({ length: 2000 }, (_, i) => `${' '.repeat(i % 60)}- x`).join(
        '\n',
      ),
    ],
    [
      'a huge table',
      `| ${'a | '.repeat(300)}\n|${'---|'.repeat(300)}\n${Array.from({ length: 150 }, () => `| ${'x | '.repeat(300)}`).join('\n')}`.slice(
        0,
        limit,
      ),
    ],
    ['many emphasis marks', '*a'.repeat(limit / 2)],
    ['many links', 'https://e.example/a '.repeat(limit / 20)],
    ['many emoji', '👨‍👩‍👧‍👦'.repeat(limit / 11)],
    ['many tags', '<a href="x">'.repeat(limit / 12)],
  ])(
    'Given %s, When rendered, Then it ends quickly with allowed HTML',
    (_name, source) => {
      const started = performance.now()
      const html = render(source.slice(0, limit))
      expect(performance.now() - started).toBeLessThan(3000)
      expect(onlyAllowed(html)).toBe(true)
    },
  )
})
