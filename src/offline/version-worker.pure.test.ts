import { beforeEach, describe, expect, test } from 'vitest'
import {
  OFFLINE_MAX_AGE_MS,
  STORED_AT_HEADER,
  STORED_AT_PLACEHOLDER,
} from './limits'
import { keepFiles, respond, type VersionWorkerDeps } from './version-worker'

const ORIGIN = 'https://d-1.content.example'
const START = 1_700_000_000_000

const TOP = `<!doctype html><script>${STORED_AT_PLACEHOLDER}</script><h1>Deck</h1>`

const offline = (): Response => {
  throw new TypeError('offline')
}

/** A disk of one version, and the service it asks, that the test steers. */
function world() {
  const disk = new Map<string, Response>()
  const pending: Promise<unknown>[] = []
  const state = {
    now: START,
    service: offline as (request: Request) => Response | Promise<Response>,
    asked: [] as string[],
    cacheDeleted: 0,
  }
  const deps: VersionWorkerDeps = {
    origin: ORIGIN,
    now: () => state.now,
    ask: async (request) => {
      state.asked.push(request.url)
      return state.service(request)
    },
    openCache: async () => ({
      match: async (key) => disk.get(key)?.clone(),
      put: async (key, response) => void disk.set(key, response),
      delete: async (key) => disk.delete(key),
    }),
    deleteCache: async () => {
      state.cacheDeleted += 1
      disk.clear()
    },
    waitUntil: (work) => void pending.push(work),
  }
  const settle = () => Promise.all(pending.splice(0))
  return { disk, state, deps, settle }
}

const page = (
  body: string,
  headers: Record<string, string> = {},
  status = 200,
) =>
  new Response(status === 304 ? null : body, {
    status,
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache, no-transform',
      ...headers,
    },
  })

/** `Response.type` is 'default' for a built response; the browser says 'basic' for a fetched one. */
const basic = (response: Response) => {
  Object.defineProperty(response, 'type', { value: 'basic' })
  return response
}

const ask = (path: string) => new Request(`${ORIGIN}${path}`)

let w: ReturnType<typeof world>
beforeEach(() => {
  w = world()
})

/** Opens a page while the service is up, so it is kept. */
async function openOnline(path: string, body: string) {
  w.state.service = () => basic(page(body))
  const shown = await respond(w.deps, ask(path))
  await w.settle()
  return shown
}

describe('F37-AC5 and AC6: the service first, always', () => {
  test('Given a stored copy, When the service answers, Then what it sent is shown and the copy is replaced', async () => {
    await openOnline('/', TOP.replace('Deck', 'Old'))
    w.state.now += 1000
    w.state.service = () => basic(page(TOP.replace('Deck', 'New')))
    const shown = await respond(w.deps, ask('/'))
    await w.settle()
    expect(await shown.text()).toContain('New')
    expect(w.state.asked).toHaveLength(2)
    const kept = w.disk.get(`${ORIGIN}/`)
    expect(await kept?.text()).toContain('New')
    expect(kept?.headers.get(STORED_AT_HEADER)).toBe(String(START + 1000))
  })

  test('Given the service answers, When it is shown, Then the page does not claim to be stored', async () => {
    const shown = await openOnline('/', TOP)
    expect(await shown.text()).toContain(STORED_AT_PLACEHOLDER)
  })

  test('Given a preloaded answer, When the worker answers, Then it does not ask the service a second time', async () => {
    w.state.service = () => {
      throw new Error('asked again')
    }
    const shown = await respond(
      w.deps,
      ask('/'),
      Promise.resolve(basic(page(TOP))),
    )
    await w.settle()
    expect(await shown.text()).toBe(TOP)
    expect(w.state.asked).toEqual([])
    expect(w.disk.has(`${ORIGIN}/`)).toBe(true)
  })

  test('Given a preload that failed, When the worker answers, Then it asks the service itself', async () => {
    w.state.service = () => basic(page(TOP))
    const shown = await respond(
      w.deps,
      ask('/'),
      Promise.reject(new Error('preload')),
    )
    expect(shown.status).toBe(200)
    expect(w.state.asked).toHaveLength(1)
  })
})

describe('F37-AC1, AC3, AC4: a stored copy when the service does not answer', () => {
  beforeEach(async () => {
    await openOnline('/', TOP)
    await openOnline('/css/site.css', 'h1{}')
  })

  test.each([
    ['no connection', offline],
    ['429', () => page('slow down', { 'Retry-After': '60' }, 429)],
    ['500', () => page('oops', {}, 500)],
    [
      '503 of maintenance',
      () =>
        page(
          'Under maintenance',
          {
            'Retry-After': '300',
            'X-Slide-Intended': 'maintenance',
            'X-Slide-Maintenance': 'on',
          },
          503,
        ),
    ],
  ])(
    'Given %s, When the version is opened, Then the stored page is shown with its time',
    async (_, down) => {
      w.state.service = down
      w.state.now += 1000
      const shown = await respond(w.deps, ask('/'))
      const text = await shown.text()
      expect(shown.status).toBe(200)
      expect(text).toContain(`const storedAt = ${START} /*slide-stored-at*/`)
      expect(text).not.toContain(STORED_AT_PLACEHOLDER)
      expect(text).toContain('<h1>Deck</h1>')
    },
  )

  test('Given the service is down, When a file other than the top page is asked, Then the stored file is shown as it is', async () => {
    w.state.service = () => page('', {}, 503)
    const shown = await respond(w.deps, ask('/css/site.css'))
    expect(await shown.text()).toBe('h1{}')
  })

  test('Given the service is down, When the top page is asked with a fragment, Then the same copy is found', async () => {
    w.state.service = () => page('', {}, 503)
    const shown = await respond(w.deps, ask('/#7'))
    expect(await shown.text()).toContain('<h1>Deck</h1>')
  })

  test('F37-AC12: Given a file never opened, When the service is down, Then nothing is stored and the failure is not hidden', async () => {
    w.state.service = offline
    expect((await respond(w.deps, ask('/never.html'))).type).toBe('error')
    w.state.service = () => page('Under maintenance', {}, 503)
    const shown = await respond(w.deps, ask('/never.html'))
    expect(shown.status).toBe(503)
    expect(await shown.text()).toBe('Under maintenance')
  })
})

describe('F37-AC7 to AC9: a version the service withdraws is dropped', () => {
  test.each([404, 410, 403])(
    'Given %i, When the version is opened, Then the stored files are gone and nothing stored is shown',
    async (status) => {
      await openOnline('/', TOP)
      await openOnline('/a.css', 'a')
      w.state.service = () => page('Not found', {}, status)
      const shown = await respond(w.deps, ask('/'))
      await w.settle()
      expect(shown.status).toBe(status)
      expect(w.state.cacheDeleted).toBe(1)
      expect(w.disk.size).toBe(0)
      w.state.service = offline
      expect((await respond(w.deps, ask('/'))).type).toBe('error')
    },
  )

  test('Given a withdrawn answer for one file, When another file is asked while offline, Then it is not shown either', async () => {
    await openOnline('/', TOP)
    await openOnline('/a.css', 'a')
    w.state.service = () => page('gone', {}, 410)
    await respond(w.deps, ask('/a.css'))
    await w.settle()
    w.state.service = offline
    expect((await respond(w.deps, ask('/'))).type).toBe('error')
  })
})

describe('F37-AC10: a day is the most', () => {
  test.each([
    [OFFLINE_MAX_AGE_MS, true],
    [OFFLINE_MAX_AGE_MS + 1, false],
    [-1, false],
  ])(
    'Given the page was fetched %i ms ago, When the service is down, Then it is shown: %s',
    async (age, shown) => {
      await openOnline('/', TOP)
      w.state.now = START + age
      w.state.service = offline
      const answer = await respond(w.deps, ask('/'))
      expect(answer.type === 'error').toBe(!shown)
      if (!shown) expect(w.disk.has(`${ORIGIN}/`)).toBe(false)
    },
  )

  test('Given a copy that no longer carries a time, Then it is not shown', async () => {
    await openOnline('/', TOP)
    w.disk.set(`${ORIGIN}/`, page(TOP))
    w.state.service = offline
    expect((await respond(w.deps, ask('/'))).type).toBe('error')
  })
})

describe('what is not kept', () => {
  test('Given an answer meant for the author alone, Then it is shown but not kept', async () => {
    w.state.service = () =>
      basic(page(TOP, { 'Cache-Control': 'private, no-store, no-transform' }))
    await respond(w.deps, ask('/'))
    await w.settle()
    expect(w.disk.size).toBe(0)
  })

  test('Given a top page without the marker, Then it is not kept and so never shown as stored', async () => {
    await openOnline('/', '<h1>no script was put in</h1>')
    expect(w.disk.size).toBe(0)
    w.state.service = offline
    expect((await respond(w.deps, ask('/'))).type).toBe('error')
  })

  test('Given a stored top page whose marker appears twice, Then it is not shown', async () => {
    await openOnline('/', TOP)
    const kept = w.disk.get(`${ORIGIN}/`)!
    w.disk.set(
      `${ORIGIN}/`,
      new Response(`${TOP}${STORED_AT_PLACEHOLDER}`, { headers: kept.headers }),
    )
    w.state.service = offline
    expect((await respond(w.deps, ask('/'))).type).toBe('error')
  })

  test.each([[301], [304], [400], [206]])(
    'Given %i, Then nothing is kept',
    async (status) => {
      w.state.service = () => basic(page('x', {}, status))
      const shown = await respond(w.deps, ask('/x'))
      await w.settle()
      expect(shown.status).toBe(status)
      expect(w.disk.size).toBe(0)
    },
  )

  test("Given the disk fails, When the service is down, Then the failure is the browser's own", async () => {
    const broken: VersionWorkerDeps = {
      ...w.deps,
      openCache: async () => {
        throw new Error('quota')
      },
    }
    w.state.service = offline
    expect((await respond(broken, ask('/'))).type).toBe('error')
    w.state.service = () => page('down', {}, 503)
    expect((await respond(broken, ask('/'))).status).toBe(503)
  })

  test('Given the disk fails, When the service answers, Then the answer is still shown', async () => {
    const broken: VersionWorkerDeps = {
      ...w.deps,
      openCache: async () => {
        throw new Error('quota')
      },
    }
    w.state.service = () => basic(page(TOP))
    const shown = await respond(broken, ask('/'))
    await w.settle()
    expect(shown.status).toBe(200)
  })
})

describe('keepFiles: what a frame loaded before the worker was in charge', () => {
  test('Given addresses of this origin, When they are kept, Then each is asked of the service and kept', async () => {
    w.state.service = (request) =>
      basic(new URL(request.url).pathname === '/' ? page(TOP) : page('x'))
    const kept = await keepFiles(w.deps, [
      `${ORIGIN}/`,
      `${ORIGIN}/a.css#x`,
      `${ORIGIN}/a.css`,
      `${ORIGIN}/b.js`,
    ])
    expect(kept).toBe(3)
    expect([...w.disk.keys()].sort()).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/a.css`,
      `${ORIGIN}/b.js`,
    ])
  })

  test("Given addresses of other origins and the service's own paths, Then none is asked", async () => {
    w.state.service = () => basic(page('x'))
    const kept = await keepFiles(w.deps, [
      'https://elsewhere.example/a.js',
      `${ORIGIN}/_preview/sw.js`,
      'https://d-2.content.example/',
    ])
    expect(kept).toBe(0)
    expect(w.state.asked).toEqual([])
  })

  test('Given the service withdraws the version while keeping, Then the disk is emptied', async () => {
    w.state.service = () => page('gone', {}, 404)
    await keepFiles(w.deps, [`${ORIGIN}/`])
    expect(w.state.cacheDeleted).toBe(1)
  })

  test('Given a file that fails, Then the others are still kept', async () => {
    w.state.service = (request) => {
      if (request.url.endsWith('/bad')) throw new TypeError('reset')
      return basic(page('ok'))
    }
    expect(await keepFiles(w.deps, [`${ORIGIN}/bad`, `${ORIGIN}/good`])).toBe(1)
  })

  test('Given none, Then nothing happens', async () => {
    expect(await keepFiles(w.deps, [])).toBe(0)
  })
})
