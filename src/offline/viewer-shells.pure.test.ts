import { beforeEach, describe, expect, test } from 'vitest'
import {
  CONTENT_ORIGIN_HEADER,
  EVICT_CACHE,
  OFFLINE_MAX_AGE_MS,
  OFFLINE_MAX_VERSIONS,
  STORED_AT_HEADER,
  VIEWER_CACHE,
} from './limits'
import { evictKey } from './records'
import { shellKeeper, type ShellDeps } from './viewer-shells'

const ORIGIN = 'https://slide.example'
const BASE = 'https://content.example'
const versionOf = (n: number) =>
  `https://d-123e4567-e89b-12d3-a456-${String(n).padStart(12, '0')}.content.example`
const X = versionOf(1)
const Y = versionOf(2)
const START = 1_700_000_000_000
const DAY = OFFLINE_MAX_AGE_MS
const KEY = (slug: string) => `${ORIGIN}/@owner/${slug}`
const SHELL = '<!doctype html><h1>shell</h1>'

/** A promise the test settles by hand. */
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

/** Lets every promise that can settle without outside help settle. */
const settle = async () => {
  for (let turn = 0; turn < 50; turn += 1) await Promise.resolve()
}

function world() {
  const disks = new Map<string, Map<string, Response>>()
  const diskOf = (name: string) => {
    let disk = disks.get(name)
    if (!disk) disks.set(name, (disk = new Map()))
    return disk
  }
  const state = {
    now: START,
    /** Whether a version can be reached to clear it. */
    reachable: true,
    cleared: [] as string[],
    /** Holds `match` of a key after it has read the entry, until released. */
    hold: new Map<
      string,
      {
        reached: ReturnType<typeof deferred>
        release: ReturnType<typeof deferred>
      }
    >(),
  }
  const deps: ShellDeps = {
    managementOrigin: ORIGIN,
    contentBase: BASE,
    now: () => state.now,
    openCache: async (name) => {
      const disk = diskOf(name)
      return {
        keys: async () => [...disk.keys()].map((url) => ({ url })),
        match: async (key) => {
          const entry = disk.get(key)?.clone()
          const held = name === VIEWER_CACHE ? state.hold.get(key) : undefined
          if (held) {
            state.hold.delete(key)
            held.reached.resolve()
            await held.release.promise
          }
          return entry
        },
        put: async (key, response) => void disk.set(key, response),
        delete: async (key) => disk.delete(key),
      }
    },
    clearVersion: async (origin) => {
      if (!state.reachable) return false
      state.cleared.push(origin)
      return true
    },
  }
  const record = (slug: string, origin: string, storedAt: number) =>
    diskOf(VIEWER_CACHE).set(
      KEY(slug),
      new Response(SHELL, {
        headers: {
          [STORED_AT_HEADER]: String(storedAt),
          [CONTENT_ORIGIN_HEADER]: origin,
        },
      }),
    )
  const queue = (origin: string) =>
    diskOf(EVICT_CACHE).set(
      evictKey(ORIGIN, origin),
      new Response('', { headers: { [STORED_AT_HEADER]: String(state.now) } }),
    )
  const records = () =>
    Object.fromEntries(
      [...diskOf(VIEWER_CACHE)].map(([key, entry]) => [
        key,
        {
          storedAt: Number(entry.headers.get(STORED_AT_HEADER)),
          origin: entry.headers.get(CONTENT_ORIGIN_HEADER),
        },
      ]),
    )
  const listed = () => [...diskOf(EVICT_CACHE).keys()]
  return { state, deps, record, queue, records, listed }
}

let w: ReturnType<typeof world>
beforeEach(() => {
  w = world()
})

describe('F37-AC22: the list is cleared by a prune that does not need a stored version', () => {
  test('Given an origin on the list, When a page prunes, Then it is cleared and leaves the list', async () => {
    w.queue(Y)
    await shellKeeper(w.deps, X).prune()
    expect(w.state.cleared).toEqual([Y])
    expect(w.listed()).toEqual([])
  })

  test('Given an origin on the list and no connection to it, When a page prunes, Then it stays on the list for the next time', async () => {
    w.queue(Y)
    w.state.reachable = false
    await shellKeeper(w.deps, X).prune()
    expect(w.state.cleared).toEqual([])
    expect(w.listed()).toEqual([evictKey(ORIGIN, Y)])
  })

  test('Given a record kept for a version that is still wanted, When another origin is on the list, Then only that one is cleared', async () => {
    w.record('talk', Y, START)
    w.queue(Y)
    w.queue(versionOf(3))
    await shellKeeper(w.deps, X).prune()
    expect(w.state.cleared).toEqual([versionOf(3)])
    expect(w.listed()).toEqual([])
  })

  test.each([
    ['an origin outside the content domain', 'https://evil.example'],
    ['an origin that is not a version', 'https://content.example'],
    ['an empty origin', ''],
  ])(
    'Given %s on the list, When a page prunes, Then it is dropped from the list and nothing is cleared',
    async (_, origin) => {
      w.queue(origin)
      await shellKeeper(w.deps, X).prune()
      expect(w.state.cleared).toEqual([])
      expect(w.listed()).toEqual([])
    },
  )

  test('Given the version the page shows is on the list, When the page prunes, Then it is taken off the list and not cleared', async () => {
    w.queue(X)
    await shellKeeper(w.deps, X).prune()
    expect(w.state.cleared).toEqual([])
    expect(w.listed()).toEqual([])
  })
})

describe('F37-AC10, AC11: what prune drops is unchanged', () => {
  test('Given a record a day and a millisecond old, When a page prunes, Then it is dropped and its version cleared', async () => {
    w.record('talk', Y, START - DAY - 1)
    await shellKeeper(w.deps, X).prune()
    expect(w.records()).toEqual({})
    expect(w.state.cleared).toEqual([Y])
  })

  test('Given a record exactly a day old, When a page prunes, Then it stays', async () => {
    w.record('talk', Y, START - DAY)
    await shellKeeper(w.deps, X).prune()
    expect(Object.keys(w.records())).toEqual([KEY('talk')])
    expect(w.state.cleared).toEqual([])
  })

  test('Given an expired record of the version the page shows, When a page prunes, Then the record goes but the version is not cleared', async () => {
    w.record('talk', X, START - DAY - 1)
    await shellKeeper(w.deps, X).prune()
    expect(w.records()).toEqual({})
    expect(w.state.cleared).toEqual([])
    expect(w.listed()).toEqual([])
  })

  test('Given 20 versions kept, When a 21st is kept, Then the one opened longest ago is dropped and its version cleared', async () => {
    for (let n = 0; n < OFFLINE_MAX_VERSIONS; n += 1)
      w.record(`deck${n}`, versionOf(100 + n), START - 1000 + n)
    const newest = versionOf(999)
    await shellKeeper(w.deps, newest).keep(SHELL, '/@owner/new', newest)
    expect(Object.keys(w.records())).toHaveLength(OFFLINE_MAX_VERSIONS)
    expect(w.records()[KEY('deck0')]).toBeUndefined()
    expect(w.records()[KEY('new')]?.origin).toBe(newest)
    expect(w.state.cleared).toEqual([versionOf(100)])
  })
})

describe('F37-AC6: keeping a shell', () => {
  test('Given a deck kept for a version, When another version is kept, Then the new one replaces it and the old one is cleared', async () => {
    w.record('talk', Y, START - 10)
    w.state.now = START
    await shellKeeper(w.deps, X).keep(SHELL, '/@owner/talk', X)
    expect(w.records()).toEqual({
      [KEY('talk')]: { storedAt: START, origin: X },
    })
    expect(w.state.cleared).toEqual([Y])
    expect(w.listed()).toEqual([])
  })

  test('Given a deck kept for a version, When the same version is kept again, Then only the time changes and nothing is cleared', async () => {
    w.record('talk', X, START - 10)
    await shellKeeper(w.deps, X).keep(SHELL, '/@owner/talk', X)
    expect(w.records()).toEqual({
      [KEY('talk')]: { storedAt: START, origin: X },
    })
    expect(w.state.cleared).toEqual([])
  })
})

describe('F37-AC22: a prune and a write of a shell never interleave', () => {
  test('Given a prune that has read an expired record, When the frame says it stored the same version, Then the fresh shell and the version both survive', async () => {
    w.record('talk', X, START - DAY - 1)
    const keeper = shellKeeper(w.deps, X)
    const reached = deferred()
    const release = deferred()
    w.state.hold.set(KEY('talk'), { reached, release })
    const pruned = keeper.prune()
    await reached.promise
    // The `stored` message arrives while the prune holds what it read.
    const kept = keeper.keep(SHELL, '/@owner/talk', X)
    await settle()
    expect(w.records()[KEY('talk')]?.storedAt).toBe(START - DAY - 1)
    release.resolve()
    await Promise.all([pruned, kept])
    expect(w.records()).toEqual({
      [KEY('talk')]: { storedAt: START, origin: X },
    })
    expect(w.state.cleared).toEqual([])
    expect(w.listed()).toEqual([])
  })

  test('Given a prune that has read an expired record of an older version, When the frame says it stored the new one, Then the fresh shell survives and the older version is cleared', async () => {
    w.record('talk', Y, START - DAY - 1)
    const keeper = shellKeeper(w.deps, X)
    const reached = deferred()
    const release = deferred()
    w.state.hold.set(KEY('talk'), { reached, release })
    const pruned = keeper.prune()
    await reached.promise
    const kept = keeper.keep(SHELL, '/@owner/talk', X)
    await settle()
    release.resolve()
    await Promise.all([pruned, kept])
    expect(w.records()).toEqual({
      [KEY('talk')]: { storedAt: START, origin: X },
    })
    expect(w.state.cleared).toEqual([Y])
    expect(w.listed()).toEqual([])
  })

  test('Given a prune waiting for a version to answer, When a shell is written, Then the write waits and the prune then sees it', async () => {
    w.queue(Y)
    const answer = deferred()
    const deps: ShellDeps = {
      ...w.deps,
      clearVersion: async (origin) => {
        await answer.promise
        return w.deps.clearVersion(origin)
      },
    }
    const keeper = shellKeeper(deps, X)
    const pruned = keeper.prune()
    await settle()
    const kept = keeper.keep(SHELL, '/@owner/talk', X)
    await settle()
    expect(w.records()).toEqual({})
    answer.resolve()
    await Promise.all([pruned, kept])
    expect(Object.keys(w.records())).toEqual([KEY('talk')])
  })

  test('Given a prune that fails, When a shell is kept next, Then it is written', async () => {
    const deps: ShellDeps = {
      ...w.deps,
      openCache: async (name) => {
        if (name === EVICT_CACHE) throw new Error('storage failed')
        return w.deps.openCache(name)
      },
    }
    const keeper = shellKeeper(deps, X)
    await expect(keeper.prune()).rejects.toThrow('storage failed')
    await expect(keeper.keep(SHELL, '/@owner/talk', X)).rejects.toThrow()
    expect(Object.keys(w.records())).toEqual([KEY('talk')])
  })
})
