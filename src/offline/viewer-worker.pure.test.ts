import { beforeEach, describe, expect, test } from 'vitest'
import {
  CONTENT_ORIGIN_HEADER,
  EVICT_CACHE,
  OFFLINE_MAX_AGE_MS,
  SHELL_SCRIPT_PATH,
  STATIC_CACHE,
  STORED_AT_HEADER,
  VIEWER_CACHE,
} from './limits'
import { evictKey } from './records'
import {
  installScript,
  isShellScript,
  isViewerNavigation,
  respondScript,
  respondViewer,
  type ViewerWorkerDeps,
} from './viewer-worker'

const ORIGIN = 'https://slide.example'
const VERSION = 'https://d-123e4567-e89b-12d3-a456-426614174000.content.example'
const START = 1_700_000_000_000
const offline = (): Response => {
  throw new TypeError('offline')
}

function world() {
  const caches = new Map<string, Map<string, Response>>()
  const pending: Promise<unknown>[] = []
  const state = {
    now: START,
    service: offline as (request: Request) => Response | Promise<Response>,
    asked: 0,
  }
  const diskOf = (name: string) => {
    let disk = caches.get(name)
    if (!disk) caches.set(name, (disk = new Map()))
    return disk
  }
  const deps: ViewerWorkerDeps = {
    origin: ORIGIN,
    now: () => state.now,
    ask: async (request) => {
      state.asked += 1
      return state.service(request)
    },
    openCache: async (name) => {
      const disk = diskOf(name)
      return {
        match: async (key) => disk.get(key)?.clone(),
        put: async (key, response) => void disk.set(key, response),
        delete: async (key) => disk.delete(key),
      }
    },
    waitUntil: (work) => void pending.push(work),
  }
  return { state, deps, diskOf, settle: () => Promise.all(pending.splice(0)) }
}

const navigate = (path: string) =>
  new Request(`${ORIGIN}${path}`, { headers: {} })
const viewerPage = (status = 200, headers: Record<string, string> = {}) =>
  new Response(status === 200 ? '<h1>live viewer</h1>' : `status ${status}`, {
    status,
    headers: { 'Cache-Control': 'no-cache', ...headers },
  })
const basic = (response: Response) => {
  Object.defineProperty(response, 'type', { value: 'basic' })
  return response
}
const SHELL = '<!doctype html><h1>shell</h1>'

let w: ReturnType<typeof world>
beforeEach(() => {
  w = world()
})

const keepShell = (path = '/@a/talk', age = 0, origin = VERSION) =>
  w.diskOf(VIEWER_CACHE).set(
    `${ORIGIN}${path}`,
    new Response(SHELL, {
      headers: {
        [STORED_AT_HEADER]: String(START - age),
        [CONTENT_ORIGIN_HEADER]: origin,
      },
    }),
  )

describe('isViewerNavigation', () => {
  const nav = (url: string, method = 'GET', mode = 'navigate') => ({
    url,
    method,
    mode,
  })
  test.each([
    [nav(`${ORIGIN}/@a/talk`), true],
    [nav(`${ORIGIN}/@a/talk/3`), true],
    [nav(`${ORIGIN}/@a/talk?lang=en`), true],
    [nav(`${ORIGIN}/@a`), false],
    [nav(`${ORIGIN}/help`), false],
    [nav(`${ORIGIN}/@a/talk`, 'POST'), false],
    [nav(`${ORIGIN}/@a/talk`, 'GET', 'cors'), false],
    [nav(`${ORIGIN}/@a/talk`, 'GET', 'no-cors'), false],
    [nav(`https://other.example/@a/talk`), false],
  ])('Given %j, Then it is answered: %s', (request, answered) => {
    expect(isViewerNavigation(request, ORIGIN)).toBe(answered)
  })

  test("Given the shell script and other files, Then only the script is the shell's", () => {
    expect(
      isShellScript(
        { method: 'GET', url: `${ORIGIN}${SHELL_SCRIPT_PATH}` },
        ORIGIN,
      ),
    ).toBe(true)
    expect(
      isShellScript({ method: 'GET', url: `${ORIGIN}/share.js` }, ORIGIN),
    ).toBe(false)
    expect(
      isShellScript(
        { method: 'GET', url: `https://x.example${SHELL_SCRIPT_PATH}` },
        ORIGIN,
      ),
    ).toBe(false)
  })
})

describe('F37-AC5: the service first, always', () => {
  test('Given a kept shell, When the service answers, Then the viewer it sent is shown, not the shell', async () => {
    keepShell()
    w.state.service = () => basic(viewerPage())
    const shown = await respondViewer(w.deps, navigate('/@a/talk'))
    expect(await shown.text()).toBe('<h1>live viewer</h1>')
    expect(w.state.asked).toBe(1)
  })

  test('Given the service answers, Then nothing of the viewer page is kept', async () => {
    w.state.service = () => basic(viewerPage())
    await respondViewer(w.deps, navigate('/@a/talk'))
    await w.settle()
    expect(w.diskOf(VIEWER_CACHE).size).toBe(0)
  })
})

describe('F37-AC1, AC3, AC4, AC12: the shell when the service does not answer', () => {
  test.each([
    ['no connection', offline],
    ['429', () => viewerPage(429, { 'Retry-After': '60' })],
    ['500', () => viewerPage(500)],
    [
      '503 of maintenance',
      () =>
        viewerPage(503, { 'X-Slide-Maintenance': 'on', 'Retry-After': '300' }),
    ],
  ])(
    'Given %s and a kept shell, When the deck is opened, Then the shell is shown under a policy that frames only its version',
    async (_, down) => {
      keepShell()
      w.state.service = down
      const shown = await respondViewer(w.deps, navigate('/@a/talk'))
      expect(shown.status).toBe(200)
      expect(await shown.text()).toBe(SHELL)
      expect(shown.headers.get('Content-Security-Policy')).toContain(
        `frame-src ${VERSION};`,
      )
      expect(shown.headers.get('Content-Security-Policy')).toContain(
        "script-src 'self'",
      )
      expect(shown.headers.get('Cache-Control')).toBe('no-store')
    },
  )

  test("Given a kept shell, When a page of the deck is opened while offline, Then the deck's shell is shown", async () => {
    keepShell()
    expect(
      await (await respondViewer(w.deps, navigate('/@a/talk/6'))).text(),
    ).toBe(SHELL)
  })

  test('Given no shell, When the service is down, Then the failure is not hidden', async () => {
    expect((await respondViewer(w.deps, navigate('/@a/never'))).type).toBe(
      'error',
    )
    w.state.service = () => viewerPage(503)
    const shown = await respondViewer(w.deps, navigate('/@a/never'))
    expect(shown.status).toBe(503)
  })

  test('Given the shell of another deck, Then it is not shown for this one', async () => {
    keepShell('/@a/other')
    expect((await respondViewer(w.deps, navigate('/@a/talk'))).type).toBe(
      'error',
    )
  })
})

describe('F37-AC10: a day is the most', () => {
  test.each([
    [OFFLINE_MAX_AGE_MS, true],
    [OFFLINE_MAX_AGE_MS + 1, false],
  ])(
    'Given a shell kept %i ms ago, When offline, Then it is shown: %s',
    async (age, shown) => {
      keepShell('/@a/talk', age)
      const answer = await respondViewer(w.deps, navigate('/@a/talk'))
      expect(answer.type === 'error').toBe(!shown)
      expect(w.diskOf(VIEWER_CACHE).has(`${ORIGIN}/@a/talk`)).toBe(shown)
    },
  )
})

describe('what the shell may name', () => {
  test.each([
    'https://evil.example',
    'https://d-1.content.example',
    `${VERSION}/path`,
    `${VERSION}; script-src *`,
    '',
    `${VERSION} https://evil.example`,
  ])(
    "Given a stored origin %j that is no version's, Then the shell is not shown",
    async (origin) => {
      keepShell('/@a/talk', 0, origin)
      expect((await respondViewer(w.deps, navigate('/@a/talk'))).type).toBe(
        'error',
      )
    },
  )
})

describe('F37-AC7 to AC9: a deck the service withdraws is forgotten', () => {
  test.each([404, 410, 403])(
    "Given %i, Then the shell is gone at once, the version is put on the list to clear, and the answer is the service's",
    async (status) => {
      keepShell()
      w.state.service = () => viewerPage(status)
      const shown = await respondViewer(w.deps, navigate('/@a/talk'))
      await w.settle()
      expect(shown.status).toBe(status)
      expect(w.diskOf(VIEWER_CACHE).size).toBe(0)
      expect([...w.diskOf(EVICT_CACHE).keys()]).toEqual([
        evictKey(ORIGIN, VERSION),
      ])
      w.state.service = offline
      expect((await respondViewer(w.deps, navigate('/@a/talk'))).type).toBe(
        'error',
      )
    },
  )

  test('Given a withdrawn deck that was never kept, Then there is nothing to clear', async () => {
    w.state.service = () => viewerPage(404)
    await respondViewer(w.deps, navigate('/@a/nothing'))
    await w.settle()
    expect(w.diskOf(EVICT_CACHE).size).toBe(0)
  })

  test('Given a shell that names no version origin, When the deck is withdrawn, Then it is dropped and nothing is listed', async () => {
    keepShell('/@a/talk', 0, 'https://evil.example')
    w.state.service = () => viewerPage(404)
    await respondViewer(w.deps, navigate('/@a/talk'))
    await w.settle()
    expect(w.diskOf(VIEWER_CACHE).size).toBe(0)
    expect(w.diskOf(EVICT_CACHE).size).toBe(0)
  })
})

describe("the shell's script", () => {
  const script = () =>
    basic(
      new Response('export {}', { headers: { 'Cache-Control': 'no-cache' } }),
    )
  const askScript = () => new Request(`${ORIGIN}${SHELL_SCRIPT_PATH}`)

  test('Given the worker is installed, Then the script is kept; and the installation fails when it cannot be', async () => {
    w.state.service = script
    await installScript(w.deps)
    expect(w.diskOf(STATIC_CACHE).has(SHELL_SCRIPT_PATH)).toBe(true)
    w.state.service = () => new Response('', { status: 500 })
    await expect(installScript(w.deps)).rejects.toThrow()
    w.state.service = offline
    await expect(installScript(w.deps)).rejects.toThrow()
  })

  test("Given a kept script, When the service does not answer, Then the kept script is given; when it does, the service's", async () => {
    w.state.service = script
    await installScript(w.deps)
    w.state.service = offline
    expect(await (await respondScript(w.deps, askScript())).text()).toBe(
      'export {}',
    )
    w.state.service = () => new Response('', { status: 503 })
    expect(await (await respondScript(w.deps, askScript())).text()).toBe(
      'export {}',
    )
    w.state.service = () =>
      basic(
        new Response('export const a = 1', {
          headers: { 'Cache-Control': 'no-cache' },
        }),
      )
    expect(await (await respondScript(w.deps, askScript())).text()).toBe(
      'export const a = 1',
    )
    await w.settle()
    expect(await w.diskOf(STATIC_CACHE).get(SHELL_SCRIPT_PATH)?.text()).toBe(
      'export const a = 1',
    )
  })

  test("Given nothing kept and no connection, Then the failure is the browser's own", async () => {
    expect((await respondScript(w.deps, askScript())).type).toBe('error')
  })
})
