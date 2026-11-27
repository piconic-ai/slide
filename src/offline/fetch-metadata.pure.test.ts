import { describe, expect, test } from 'vitest'
import { destinationOf, mayAnswerEviction } from './fetch-metadata'

describe('mayAnswerEviction', () => {
  const own = ['same-origin', 'same-site']
  test.each([
    // [dest, site, sites, answered]
    ['iframe', 'same-origin', own, true],
    ['iframe', 'same-site', own, true],
    ['iframe', 'cross-site', own, false],
    ['iframe', 'none', own, false],
    ['document', 'none', own, false],
    ['document', 'same-origin', own, false],
    ['empty', 'same-origin', own, false],
    ['script', 'same-origin', own, false],
    // No metadata: a browser that sends none is answered as before.
    [undefined, undefined, own, true],
    ['iframe', undefined, own, true],
    [undefined, 'cross-site', own, false],
    // Any site may frame the version's own page, but only a frame.
    ['iframe', 'cross-site', null, true],
    ['iframe', 'same-site', null, true],
    ['document', 'none', null, false],
    ['document', 'cross-site', null, false],
  ] as const)(
    'F37-AC7: Given Sec-Fetch-Dest %s and Sec-Fetch-Site %s, Then it answers: %s',
    (dest, site, sites, answered) => {
      expect(mayAnswerEviction({ dest, site }, sites)).toBe(answered)
    },
  )
})

describe('destinationOf', () => {
  test.each([
    // [dest, site, replayed, destination]
    // The viewer's worker asking for a move to the page.
    ['empty', 'same-origin', 'document', 'document'],
    // A browser's own request is what it says it is, whatever else it carries.
    ['document', 'none', undefined, 'document'],
    ['document', 'same-origin', 'document', 'document'],
    ['iframe', 'cross-site', 'document', 'iframe'],
    ['image', 'same-origin', 'document', 'image'],
    // A script's fetch, which names nothing.
    ['empty', 'same-origin', undefined, 'empty'],
    ['empty', 'same-origin', '', 'empty'],
    // Only a document is named.
    ['empty', 'same-origin', 'iframe', 'empty'],
    ['empty', 'same-origin', 'Document', 'empty'],
    ['empty', 'same-origin', 'document, document', 'empty'],
    // Not from this origin: not the worker.
    ['empty', 'same-site', 'document', 'empty'],
    ['empty', 'cross-site', 'document', 'empty'],
    ['empty', 'none', 'document', 'empty'],
    ['empty', undefined, 'document', 'empty'],
    // No metadata at all: nothing to go by, as before.
    [undefined, undefined, undefined, undefined],
    [undefined, 'same-origin', 'document', undefined],
  ] as const)(
    'F02-AC29: Given Sec-Fetch-Dest %s, Sec-Fetch-Site %s and a worker naming %s, Then the request is for: %s',
    (dest, site, replayed, destination) => {
      expect(destinationOf({ dest, site, replayed })).toBe(destination)
    },
  )
})
