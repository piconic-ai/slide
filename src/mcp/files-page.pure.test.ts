import { describe, expect, test } from 'vitest'
import {
  decodeCursor,
  encodeCursor,
  FILES_PAGE_SIZE,
  MAX_CURSOR_LENGTH,
  pageOf,
  type Cursor,
  type Page,
  type PagedVersion,
} from './files-page'

const files = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    path: `${prefix}/${String(i).padStart(4, '0')}.html`,
  }))
const version = (
  role: 'published' | 'prepared',
  count: number,
): PagedVersion<{ path: string }> => ({
  role,
  deploymentId: `dep-${role}`,
  files: files(role, count),
})

/** Walks every page and returns what each held. */
function walk(
  versions: readonly PagedVersion<{ path: string }>[],
  size: number,
) {
  const pages: string[][] = []
  let cursor: Cursor | null = null
  for (let guard = 0; guard < 1000; guard++) {
    const page: Page<{ path: string }> = pageOf(versions, cursor, size)
    if (page.kind !== 'page') throw new Error('stale')
    pages.push(
      page.slices.flatMap(({ role, files: slice }) =>
        slice.map(({ path }) => `${role}:${path}`),
      ),
    )
    if (page.next === null) return pages
    cursor = page.next
  }
  throw new Error('did not end')
}

describe('which files an answer holds', () => {
  test.each([
    [[0, 0], 5],
    [[1, 0], 5],
    [[5, 0], 5],
    [[6, 0], 5],
    [[3, 4], 5],
    [[5, 5], 5],
    [[10, 11], 5],
    [[0, 7], 3],
    [[100, 20], FILES_PAGE_SIZE],
    [[101, 1], FILES_PAGE_SIZE],
    [[300, 300], FILES_PAGE_SIZE],
  ] as const)(
    'F35-AC34: Given versions of %j files and pages of %i, When every page is walked, Then each file is listed once, in order, and no page is over the size',
    ([published, prepared], size) => {
      const versions = [
        version('published', published),
        version('prepared', prepared),
      ]
      const pages = walk(versions, size)
      const expected = versions.flatMap(({ role, files: all }) =>
        all.map(({ path }) => `${role}:${path}`),
      )
      expect(pages.flat()).toEqual(expected)
      for (const page of pages) expect(page.length).toBeLessThanOrEqual(size)
      // Only the last page may be short, and only an empty slide has none.
      for (const page of pages.slice(0, -1)) expect(page).toHaveLength(size)
    },
  )

  test('F35-AC34: Given no version, When the first page is asked, Then it is empty and nothing follows', () => {
    expect(pageOf([], null)).toEqual({ kind: 'page', slices: [], next: null })
  })

  test('F35-AC34: Given a page that ends exactly at the end of a version, When the next is asked, Then it starts at the next version', () => {
    const versions = [version('published', 3), version('prepared', 2)]
    const first = pageOf(versions, null, 3)
    if (first.kind !== 'page' || !first.next) throw new Error('no cursor')
    expect(first.slices.map(({ role }) => role)).toEqual(['published'])
    const second = pageOf(versions, first.next, 3)
    expect(second).toMatchObject({
      kind: 'page',
      next: null,
      slices: [{ role: 'prepared', files: files('prepared', 2) }],
    })
  })

  test('F35-AC34: Given a page that spans both versions, When it is read, Then each version is its own slice', () => {
    const page = pageOf(
      [version('published', 2), version('prepared', 3)],
      null,
      4,
    )
    expect(page).toMatchObject({
      slices: [
        { role: 'published', files: files('published', 2) },
        { role: 'prepared', files: files('prepared', 3).slice(0, 2) },
      ],
      next: { role: 'prepared', after: 'prepared/0001.html' },
    })
  })

  test.each([
    [
      'a version that is gone',
      {
        role: 'prepared' as const,
        deploymentId: 'dep-prepared',
        after: 'prepared/0000.html',
      },
      [version('published', 2)],
    ],
    [
      'a version put up since',
      {
        role: 'published' as const,
        deploymentId: 'dep-old',
        after: 'published/0000.html',
      },
      [version('published', 2)],
    ],
    [
      'a file that is not there',
      {
        role: 'published' as const,
        deploymentId: 'dep-published',
        after: 'nope',
      },
      [version('published', 2)],
    ],
  ])(
    'F35-AC34: Given a cursor naming %s, When the next page is asked, Then it is stale',
    (_, cursor, versions) => {
      expect(pageOf(versions, cursor)).toEqual({ kind: 'stale' })
    },
  )

  test('F35-AC34: Given paths that sort differently as UTF-16 and as UTF-8, When the pages are walked, Then the order given is kept, matched exactly', () => {
    const all = [
      { path: '～.html' },
      { path: '\u{1f600}.html' },
      { path: 'z.html' },
    ]
    const versions: PagedVersion<{ path: string }>[] = [
      { role: 'published', deploymentId: 'd', files: all },
    ]
    expect(walk(versions, 1).flat()).toEqual(
      all.map(({ path }) => `published:${path}`),
    )
  })
})

describe('the cursor as text', () => {
  const cursor = {
    role: 'prepared' as const,
    deploymentId: 'dep',
    after: '日本語/資料 (1).html',
  }

  test('F35-AC34: Given a cursor, When it is written and read back, Then it is the same, whatever the path holds', () => {
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
    expect(encodeCursor(cursor)).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  test('F35-AC34: Given the longest path a file may have, When a cursor holds it, Then it still fits the longest cursor read', () => {
    const longest = { ...cursor, after: 'é'.repeat(256) }
    expect(encodeCursor(longest).length).toBeLessThanOrEqual(MAX_CURSOR_LENGTH)
    expect(decodeCursor(encodeCursor(longest))).toEqual(longest)
  })

  test.each([
    ['empty text', ''],
    ['not base64url', 'a b'],
    ['base64 that is not JSON', btoa('hello').replaceAll('=', '')],
    ['JSON of another shape', btoa('{"r":"x"}').replaceAll('=', '')],
    [
      'a role this service has not',
      btoa('{"r":"past","d":"d","a":"a"}').replaceAll('=', ''),
    ],
    ['a cursor longer than any made', 'A'.repeat(MAX_CURSOR_LENGTH + 1)],
    ['bytes that are not UTF-8', btoa('\xff\xfe').replaceAll('=', '')],
  ])(
    'F35-AC34: Given %s, When it is read as a cursor, Then it is none',
    (_, text) => {
      expect(decodeCursor(text)).toBeNull()
    },
  )
})
