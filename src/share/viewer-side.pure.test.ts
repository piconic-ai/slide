import { describe, expect, test } from 'vitest'
import { hasSideColumn } from './viewer-side'

describe('F03-AC132, F03-AC134, F03-AC135: when the viewer has a right column', () => {
  test.each([
    ['a description', { description: 'About', links: 0, citations: 0 }],
    ['related links', { description: null, links: 1, citations: 0 }],
    ['citations', { description: null, links: 0, citations: 3 }],
    ['all three', { description: 'About', links: 2, citations: 1 }],
  ])(
    'Given %s, When the viewer is drawn, Then it has a column',
    (_n, parts) => {
      expect(hasSideColumn(parts)).toBe(true)
    },
  )

  test.each([
    ['nothing', { description: null, links: 0, citations: 0 }],
    ['an empty description', { description: '', links: 0, citations: 0 }],
    ['a blank description', { description: ' \n ', links: 0, citations: 0 }],
  ])(
    'Given %s, When the viewer is drawn, Then only the author is left and it has no column',
    (_n, parts) => {
      expect(hasSideColumn(parts)).toBe(false)
    },
  )
})
