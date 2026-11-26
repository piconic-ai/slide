import { describe, expect, it } from 'vitest'
import { renderRegistry } from './help-registry-text.mjs'

describe('the help’s registry text', () => {
  it('F36-AC12: Given the keys of some article files, When the registry is written, Then each is imported once and listed once, in order', () => {
    const text = renderRegistry(['slides/b-two', 'start/a', 'slides/a'])
    expect(text).toContain(
      "import article_slides_a from './articles/slides/a'\nimport article_slides_b_two from './articles/slides/b-two'\nimport article_start_a from './articles/start/a'",
    )
    expect(text).toContain(
      "  ['slides/a', article_slides_a],\n  ['slides/b-two', article_slides_b_two],\n  ['start/a', article_start_a],\n]",
    )
  })

  it('F36-AC12: Given one more file, When the registry is written, Then only that file is added, with no table of its own to edit', () => {
    const before = renderRegistry(['slides/a', 'start/a']).split('\n')
    const after = renderRegistry([
      'slides/a',
      'slides/new-one',
      'start/a',
    ]).split('\n')
    expect(after.filter((line) => !before.includes(line))).toEqual([
      "import article_slides_new_one from './articles/slides/new-one'",
      "  ['slides/new-one', article_slides_new_one],",
    ])
  })

  it('F36-AC12: Given the same keys in another order, When the registry is written, Then the text is the same', () => {
    expect(renderRegistry(['b/x', 'a/y'])).toBe(renderRegistry(['a/y', 'b/x']))
  })

  it('F36-AC12: Given no article, When the registry is written, Then it is an empty list', () => {
    expect(renderRegistry([])).toContain(
      'HELP_REGISTRY: readonly RegisteredArticle[] = [\n]',
    )
  })
})
