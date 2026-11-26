import { describe, expect, it } from 'vitest'
import { firstFrame, subresources } from './html-resources.mjs'
import { evenStarts, mulberry32, randomStarts, viewsIn } from './plan.mjs'
import { runSchedule } from './runner.mjs'
import { main, parseArgs, parseCookies } from './run-command.mjs'
import { slideFiles } from './scenarios.mjs'
import { percentile, renderSummary, summarize } from './stats.mjs'

describe('the report', () => {
  it('COST-AC5: Given ten times, When percentiles are taken, Then they are the nearest ranks', () => {
    const times = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    expect(percentile(times, 50)).toBe(50)
    expect(percentile(times, 90)).toBe(90)
    expect(percentile(times, 99)).toBe(100)
    expect(percentile(times, 0)).toBe(10)
    expect(percentile([], 50)).toBeNull()
    expect(percentile([7], 99)).toBe(7)
  })

  it('COST-AC5: Given responses, failures and 429s, When they are summed up, Then the statuses, the 429 share and the latency come out', () => {
    const records = [
      { name: 'a', status: 200, ms: 10 },
      { name: 'a', status: 200, ms: 20 },
      { name: 'a', status: 429, ms: 5 },
      { name: 'b', status: 503, ms: 100 },
      { name: 'b', status: null, ms: 1000 },
    ]
    const summary = summarize(records)
    expect(summary.total).toBe(5)
    expect(summary.byStatus).toEqual({ 200: 2, 429: 1, 503: 1, error: 1 })
    expect(summary.rate429).toBeCloseTo(0.2, 10)
    expect(summary.errors).toBe(1)
    expect(summary.latencyMs.max).toBe(1000)
    expect(summary.latencyMs.p50).toBe(20)
    expect(summary.byName.a.byStatus).toEqual({ 200: 2, 429: 1 })
    const text = renderSummary(summary, {
      scenario: 'x',
      target: 'http://localhost:1',
      seconds: 2,
    })
    expect(text).toContain('429 share: 20.00%')
    expect(text).toContain('error: 1')
    expect(text).toContain('p99')
  })

  it('COST-AC5: Given no requests, When they are summed up, Then nothing divides by zero', () => {
    const summary = summarize([])
    expect(summary.rate429).toBe(0)
    expect(summary.latencyMs.p50).toBeNull()
    expect(
      renderSummary(summary, { scenario: 'x', target: 't', seconds: 0 }),
    ).toContain('no requests')
  })
})

describe('the schedule', () => {
  it('COST-AC5: Given 1,000 views a minute for 60 seconds, When scheduled, Then 1,000 starts are spread evenly', () => {
    const starts = evenStarts(viewsIn(1000, 60), 60)
    expect(starts).toHaveLength(1000)
    expect(starts[0]).toBe(0)
    expect(starts[1]).toBeCloseTo(60, 6)
    expect(starts.at(-1)).toBeLessThan(60_000)
  })

  it('COST-AC5: Given a seed, When 300 arrivals in a minute are drawn twice, Then they are sorted, inside the minute and the same', () => {
    const first = randomStarts(300, 60, mulberry32(1))
    const second = randomStarts(300, 60, mulberry32(1))
    expect(first).toEqual(second)
    expect(first).toEqual([...first].sort((a, b) => a - b))
    expect(first.every((at) => at >= 0 && at < 60_000)).toBe(true)
    expect(randomStarts(300, 60, mulberry32(2))).not.toEqual(first)
  })

  it('COST-AC5: Given a schedule, When it runs, Then each task starts on time and no more than the limit run at once', async () => {
    let time = 0
    let running = 0
    let peak = 0
    const startedAt = []
    const outcome = await runSchedule({
      starts: [0, 100, 200, 300],
      maxInFlight: 2,
      now: () => time,
      sleep: async (ms) => {
        time += ms
      },
      task: async (index) => {
        startedAt.push([index, time])
        running++
        peak = Math.max(peak, running)
        await Promise.resolve()
        await Promise.resolve()
        running--
      },
    })
    expect(peak).toBeLessThanOrEqual(2)
    expect(startedAt.map(([index]) => index)).toEqual([0, 1, 2, 3])
    expect(startedAt.map(([, at]) => at)).toEqual([0, 100, 200, 300])
    expect(outcome.started).toBe(4)
  })

  it('COST-AC4: Given a task that throws, When the run goes on, Then nothing more is started and the error comes out', async () => {
    let started = 0
    await expect(
      runSchedule({
        starts: [0, 0, 0, 0],
        maxInFlight: 1,
        now: () => 0,
        sleep: async () => {},
        task: async () => {
          started++
          throw new Error('stop')
        },
      }),
    ).rejects.toThrow('stop')
    expect(started).toBeLessThan(4)
  })
})

describe('reading a page like a browser', () => {
  const html = `<!doctype html>
    <link rel="stylesheet" href="/components/a.css">
    <link rel="canonical" href="/@alice/talk">
    <link rel="icon" href="/favicon.svg">
    <script src="router.js" defer></script>
    <img src='/covers/x.jpg'><img src="data:image/png;base64,AAAA">
    <a href="/help">Help</a><a href="#top">Top</a>
    <img src="https://other.example.test/pixel.png">
    <iframe src="https://d-1.localhost:8787/"></iframe>`

  it('COST-AC5: Given a page, When its subresources are listed, Then stylesheets, scripts and images come, resolved and without repeats', () => {
    expect(subresources(html, 'http://localhost:8787/@alice/talk')).toEqual([
      'http://localhost:8787/components/a.css',
      'http://localhost:8787/@alice/router.js',
      'http://localhost:8787/covers/x.jpg',
      'https://other.example.test/pixel.png',
    ])
  })

  it('COST-AC5: Given a page with a frame, When it is read, Then the frame address is found; none gives null', () => {
    expect(firstFrame(html, 'http://localhost:8787/')).toBe(
      'https://d-1.localhost:8787/',
    )
    expect(firstFrame('<p>none</p>', 'http://localhost:8787/')).toBeNull()
    expect(firstFrame('<iframe></iframe>', 'http://localhost:8787/')).toBeNull()
  })
})

describe('the files of a slide to put up', () => {
  it('COST-AC5: Given a count, When the files are made, Then there is an entry and that many less one scripts, different for each seed', () => {
    const files = slideFiles({ count: 5, bytes: 100, seed: 'a' })
    expect(files.map((file) => file.path)).toEqual([
      'index.html',
      'assets/part-0.js',
      'assets/part-1.js',
      'assets/part-2.js',
      'assets/part-3.js',
    ])
    expect(files[1].bytes.length).toBe(100)
    const other = slideFiles({ count: 5, bytes: 100, seed: 'b' })
    expect(new TextDecoder().decode(files[1].bytes)).not.toBe(
      new TextDecoder().decode(other[1].bytes),
    )
    expect(slideFiles({ count: 1, bytes: 16, seed: 'a' })).toHaveLength(1)
  })
})

describe('the arguments', () => {
  const base = [
    'hot-slide',
    '--origin',
    'http://localhost:8787',
    '--slide',
    '/@a/b',
  ]

  it.each([
    [[]],
    [['nothing']],
    [['hot-slide']],
    [['hot-slide', '--origin', 'http://localhost:8787']],
    [[...base, '--duration']],
    [[...base, '--duration', '0']],
    [[...base, '--duration', '1.5']],
    [[...base, '--duration', 'x']],
    [[...base, '--no-such', '1']],
    [['hot-slide', '--origin', 'http://localhost:8787', '--slide', 'a/b']],
    [['hot-slide', '--origin', 'http://localhost:8787', '--slide', '/@a/b/c']],
    [['post-talk-uploads', '--origin', 'http://localhost:8787']],
  ])(
    'COST-AC5: Given the bad arguments %j, When they are read, Then they are refused',
    (argv) => {
      expect(() => parseArgs(argv)).toThrow()
    },
  )

  it('COST-AC5: Given the options, When they are read, Then they set the scenario with the defaults of D-142', () => {
    const settings = parseArgs(base)
    expect(settings.viewsPerMinute).toBe(1000)
    expect(settings.viewers).toBe(300)
    expect(settings.uploads).toBe(50)
    expect(parseArgs([...base, '--duration', '5']).duration).toBe(5)
  })

  it.each([['not json'], ['[]'], ['{}'], ['[""]'], ['[1]']])(
    'COST-AC5: Given the cookie file %j, When it is read, Then it is refused',
    (text) => {
      expect(() => parseCookies(text)).toThrow()
    },
  )
})

/**
 * A fake of the service over a fake clock: the viewer page frames a slide
 * page that names two files; `limited` paths answer 429; the upload routes
 * answer as the real ones do.
 */
function fakeService({
  limited = [],
  frame = 'http://d-1.localhost:8787/',
} = {}) {
  let time = 0
  const calls = []
  const viewer = `<link rel="stylesheet" href="/components/a.css"><img src="/covers/x.jpg"><iframe src="${frame}"></iframe>`
  const slide = '<script src="app.js"></script><img src="img/a.png">'
  const io = {
    now: () => time,
    sleep: async (ms) => {
      time += ms
    },
    timeoutSignal: () => new AbortController().signal,
    readFile: async () => JSON.stringify(['cookie-a', 'cookie-b']),
    print: (text) => io.printed.push(text),
    printError: (text) => io.errors.push(text),
    printed: [],
    errors: [],
    send: async (address, init) => {
      time += 5
      const url = new URL(address)
      calls.push({ address, init, path: url.pathname })
      if (limited.includes(url.pathname))
        return new Response('', { status: 429 })
      if (url.pathname === '/@a/b') return new Response(viewer)
      if (url.pathname === '/api/session') return Response.json({})
      if (url.host.startsWith('d-1.') && url.pathname === '/')
        return new Response(slide)
      if (url.pathname === '/api/slides')
        return Response.json(
          {
            deploymentId: `dep-${calls.length}`,
            credential: 'secret',
            slug: 'x',
            files: JSON.parse(init.body).files.map((file, id) => ({
              id: String(id),
              path: file.path,
            })),
          },
          { status: 201 },
        )
      if (url.pathname.endsWith('/finalize')) return new Response('{}')
      return new Response('x')
    },
  }
  return { io, calls }
}

describe('the scenarios', () => {
  it('COST-AC5: Given hot-slide at 60 views a minute for 5 seconds, When it runs, Then 5 readers each make the 7 requests of a view', async () => {
    const { io, calls } = fakeService()
    const code = await main(
      [
        'hot-slide',
        '--origin',
        'http://localhost:8787',
        '--slide',
        '/@a/b',
        '--views-per-minute',
        '60',
        '--duration',
        '5',
        '--json',
      ],
      io,
    )
    expect(code).toBe(0)
    const report = JSON.parse(io.printed[0])
    expect(report.total).toBe(35)
    expect(report.byStatus).toEqual({ 200: 35 })
    expect(report.byName['viewer-page'].count).toBe(5)
    expect(report.byName.session.count).toBe(5)
    expect(report.byName['slide-file'].count).toBe(10)
    expect(report.rate429).toBe(0)
    expect(calls).toHaveLength(35)
    expect(report.latencyMs.p50).toBeGreaterThan(0)
  })

  it('COST-AC5: Given venue-300 from one address, When it runs, Then 300 readers open the slide, all as that address, and the 429s are counted', async () => {
    const { io, calls } = fakeService({ limited: ['/covers/x.jpg'] })
    const code = await main(
      [
        'venue-300',
        '--origin',
        'http://localhost:8787',
        '--slide',
        '/@a/b',
        '--client-ip',
        '203.0.113.7',
        '--json',
      ],
      io,
    )
    expect(code).toBe(0)
    const report = JSON.parse(io.printed[0])
    expect(report.byName['viewer-page'].count).toBe(300)
    expect(report.byStatus['429']).toBe(300)
    expect(report.rate429).toBeCloseTo(300 / 2100, 10)
    for (const call of calls)
      expect(call.init.headers['CF-Connecting-IP']).toBe('203.0.113.7')
    expect(report.seconds).toBeGreaterThan(50)
    expect(report.seconds).toBeLessThan(61)
  })

  it('COST-AC5: Given post-talk-uploads with 2 cookies, When 5 uploads run, Then each does start, one request for each file and finalize, and the cookies take turns', async () => {
    const { io, calls } = fakeService()
    const code = await main(
      [
        'post-talk-uploads',
        '--origin',
        'http://localhost:8787',
        '--cookies',
        'cookies.json',
        '--uploads',
        '5',
        '--files',
        '4',
        '--within',
        '2',
        '--json',
      ],
      io,
    )
    expect(code).toBe(0)
    const report = JSON.parse(io.printed[0])
    expect(report.byName['upload-start'].count).toBe(5)
    expect(report.byName['upload-file'].count).toBe(20)
    expect(report.byName['upload-finalize'].count).toBe(5)
    const starts = calls.filter((call) => call.path === '/api/slides')
    expect(starts.map((call) => call.init.headers.Cookie).sort()).toEqual([
      'cookie-a',
      'cookie-a',
      'cookie-a',
      'cookie-b',
      'cookie-b',
    ])
    expect(starts[0].init.headers.Origin).toBe('http://localhost:8787')
    const attempts = starts.map((call) => JSON.parse(call.init.body).attempt)
    expect(new Set(attempts).size).toBe(5)
    // The service takes 16 to 64 URL-safe characters.
    for (const attempt of attempts)
      expect(attempt).toMatch(/^[A-Za-z0-9_-]{16,64}$/)
  })

  it('COST-AC5: Given a limit of 10 requests, When a run reaches it, Then it stops and reports what was sent', async () => {
    const { io, calls } = fakeService()
    const code = await main(
      [
        'hot-slide',
        '--origin',
        'http://localhost:8787',
        '--slide',
        '/@a/b',
        '--views-per-minute',
        '600',
        '--duration',
        '5',
        '--max-requests',
        '10',
        '--json',
      ],
      io,
    )
    expect(code).toBe(0)
    expect(calls.length).toBeLessThanOrEqual(10)
    expect(io.errors.join()).toContain('limit of 10 requests')
  })

  it('COST-AC5: Given a text report, When a run ends, Then the report names the scenario, the statuses and the latency distribution', async () => {
    const { io } = fakeService()
    await main(
      [
        'hot-slide',
        '--origin',
        'http://localhost:8787',
        '--slide',
        '/@a/b',
        '--views-per-minute',
        '60',
        '--duration',
        '2',
      ],
      io,
    )
    const text = io.printed[0]
    expect(text).toContain('Scenario: hot-slide')
    expect(text).toContain('Status: 200: 14')
    expect(text).toContain('429 share: 0.00%')
    expect(text).toContain('p95')
  })
})

describe('refusing production', () => {
  const scenarios = [
    ['hot-slide', '--slide', '/@a/b'],
    ['venue-300', '--slide', '/@a/b'],
    ['post-talk-uploads', '--cookies', 'cookies.json'],
  ]

  it.each(
    scenarios.flatMap((scenario) =>
      [
        'https://slide.community',
        'http://SLIDE.COMMUNITY.:8443',
        'https://admin.slide.community',
        'https://d-1.slideusercontent.com',
        'https://slideusercontent.com:443',
      ].map((origin) => [scenario[0], origin, scenario]),
    ),
  )(
    'COST-AC4: Given %s aimed at %s, When it runs, Then it exits 2 and sends nothing',
    async (_name, origin, scenario) => {
      const { io, calls } = fakeService()
      const [name, ...rest] = scenario
      const code = await main([name, '--origin', origin, ...rest], io)
      expect(code).toBe(2)
      expect(calls).toEqual([])
      expect(io.errors.join()).toContain('Nothing was sent')
      expect(io.printed).toEqual([])
    },
  )

  it('COST-AC4: Given a local service whose page frames a production address, When a reader opens it, Then the production address is never contacted and the run stops', async () => {
    const { io, calls } = fakeService({
      frame: 'https://d-9.slideusercontent.com/',
    })
    const code = await main(
      [
        'hot-slide',
        '--origin',
        'http://localhost:8787',
        '--slide',
        '/@a/b',
        '--views-per-minute',
        '60',
        '--duration',
        '3',
      ],
      io,
    )
    expect(code).toBe(2)
    expect(
      calls.some((call) => call.address.includes('slideusercontent.com')),
    ).toBe(false)
    expect(io.errors.join()).toContain('production')
  })
})
