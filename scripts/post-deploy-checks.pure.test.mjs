import { expect, test } from 'vitest'
import {
  checkLines,
  failedChecks,
  parseOrigin,
  runPostDeployChecks,
} from './post-deploy-checks.mjs'

const origins = {
  site: new URL('https://slide.community'),
  content: new URL('https://slideusercontent.com'),
  admin: new URL('https://admin.slide.community'),
  accessTeam: new URL('https://team.cloudflareaccess.com'),
}
const MISSING =
  'https://d-00000000-0000-4000-8000-000000000000.slideusercontent.com/'

const html = (body = '<p>ok</p>', status = 200) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
const viewer = (frame) =>
  html(`<main><iframe sandbox src="${frame}"></iframe></main>`)

/** The answers of a healthy release, by address; a test changes some. */
function healthy(overrides = {}) {
  const answers = {
    'https://slide.community/': () => html(),
    'https://slide.community/robots.txt': () =>
      new Response('User-agent: *', {
        headers: { 'content-type': 'text/plain' },
      }),
    'https://slide.community/terms': () => html(),
    'https://slide.community/privacy': () => html(),
    'https://slide.community/privacy/external': () => html(),
    'https://slide.community/help': () => html(),
    'https://slide.community/login': () => html(),
    'https://slide.community/api/slides': () =>
      new Response('{}', { status: 401 }),
    'https://slide.community/api/public/slides': () =>
      Response.json([{ href: '/@alice/talk' }]),
    'https://slide.community/@alice/talk': () =>
      viewer('https://d-1234.slideusercontent.com/'),
    'https://d-1234.slideusercontent.com/': () => html(),
    [MISSING]: () => html('gone', 404),
    'https://www.slideusercontent.com/slides': () => html('gone', 404),
    'https://admin.slide.community/': () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://team.cloudflareaccess.com/' },
      }),
    ...overrides,
  }
  const asked = []
  const send = async (url) => {
    asked.push(String(url))
    const answer = answers[String(url)]
    if (!answer) throw new Error(`no answer for ${url}`)
    const made = answer()
    if (made instanceof Error) throw made
    return made
  }
  return { send, asked }
}

const run = (overrides) => {
  const { send, asked } = healthy(overrides)
  return runPostDeployChecks(origins, send).then((results) => ({
    results,
    asked,
  }))
}

test('REL-AC9: Given a healthy release, When the checks run, Then every one passes and each address is asked from the origins given', async () => {
  const { results, asked } = await run()
  expect(failedChecks(results)).toEqual([])
  expect(results.every((one) => one.state === 'ok')).toBe(true)
  expect(results.map((one) => one.name)).toEqual([
    'top page',
    'robots.txt',
    'terms',
    'privacy policy',
    'external transmissions',
    'help',
    'login',
    'slide list needs login',
    'public slide list',
    'public slide viewer',
    'public slide is served from its content origin',
    'unknown deployment origin is missing',
    'content domain serves no management page',
    'admin origin is closed outside Access',
  ])
  const hosts = new Set(asked.map((url) => new URL(url).host))
  expect([...hosts].toSorted()).toEqual([
    'admin.slide.community',
    'd-00000000-0000-4000-8000-000000000000.slideusercontent.com',
    'd-1234.slideusercontent.com',
    'slide.community',
    'www.slideusercontent.com',
  ])
})

test.each([
  ['top page', 'https://slide.community/'],
  ['terms', 'https://slide.community/terms'],
  ['privacy policy', 'https://slide.community/privacy'],
  ['external transmissions', 'https://slide.community/privacy/external'],
  ['help', 'https://slide.community/help'],
  ['login', 'https://slide.community/login'],
])(
  'REL-AC8: Given the %s answers 500, When the checks run, Then only that check fails and it is named',
  async (name, url) => {
    const { results } = await run({ [url]: () => html('boom', 500) })
    expect(failedChecks(results)).toEqual([name])
  },
)

test('REL-AC8: Given robots.txt answers HTML, When the checks run, Then it fails for its content type', async () => {
  const { results } = await run({
    'https://slide.community/robots.txt': () => html('<p>not robots</p>'),
  })
  expect(failedChecks(results)).toEqual(['robots.txt'])
  expect(results.find((one) => one.name === 'robots.txt')?.detail).toBe(
    'unexpected content type',
  )
})

test('REL-AC8: Given several things are broken, When the checks run, Then every failed one is named, not only the first', async () => {
  const { results } = await run({
    'https://slide.community/help': () => html('x', 503),
    'https://slide.community/api/slides': () => Response.json([]),
    'https://www.slideusercontent.com/slides': () => html('slides', 200),
  })
  expect(failedChecks(results)).toEqual([
    'help',
    'slide list needs login',
    'content domain serves no management page',
  ])
})

test('REL-AC8: Given a request fails on the network or times out, When the checks run, Then the check fails with a reason that names no address', async () => {
  const timeout = new Error('slow')
  timeout.name = 'TimeoutError'
  const { results } = await run({
    'https://slide.community/': () =>
      new Error('connect ECONNREFUSED 203.0.113.9:443'),
    'https://slide.community/help': () => timeout,
  })
  expect(failedChecks(results)).toEqual(['top page', 'help'])
  const lines = checkLines(results).join('\n')
  expect(lines).toContain('network error')
  expect(lines).toContain('timeout')
  expect(lines).not.toContain('203.0.113.9')
  expect(lines).not.toContain('https://')
})

test.each([200, 204, 500, 502])(
  'REL-AC9: Given the operator origin answers %i without Access, When the checks run, Then the check fails: a 2xx opens it and a 5xx hides whether it is shut',
  async (status) => {
    const { results } = await run({
      'https://admin.slide.community/': () =>
        new Response('<h1>operator</h1>', { status }),
    })
    expect(failedChecks(results)).toEqual([
      'admin origin is closed outside Access',
    ])
  },
)

test.each([401, 403, 404])(
  'REL-AC9: Given the operator origin answers %i without Access, When the checks run, Then it counts as closed',
  async (status) => {
    const { results } = await run({
      'https://admin.slide.community/': () => new Response(null, { status }),
    })
    expect(failedChecks(results)).toEqual([])
  },
)

const redirect =
  (location, status = 302) =>
  () =>
    new Response(null, {
      status,
      headers: location === null ? {} : { location },
    })

test.each([301, 302, 303, 307, 308])(
  'REL-AC9: Given the operator origin redirects with %i to the Access team host, When the checks run, Then it counts as closed',
  async (status) => {
    const { results } = await run({
      'https://admin.slide.community/': redirect(
        'https://team.cloudflareaccess.com/cdn-cgi/access/login/admin.slide.community',
        status,
      ),
    })
    expect(failedChecks(results)).toEqual([])
  },
)

test.each([
  ['another site', 'https://evil.example/login'],
  ['a look-alike host', 'https://team.cloudflareaccess.com.evil.example/'],
  ['a look-alike prefix', 'https://evilteam.cloudflareaccess.com/'],
  ['the operator origin itself', 'https://admin.slide.community/login'],
  ['the management site', 'https://slide.community/'],
  ['a port on the Access host', 'https://team.cloudflareaccess.com:8443/'],
  ['an unusable address', 'http://[bad'],
  ['nothing', null],
  ['an empty address', ''],
])(
  'REL-AC9: Given the operator origin redirects to %s, When the checks run, Then the check fails: a redirect that does not lead to Access is not a closed door',
  async (_name, location) => {
    const { results } = await run({
      'https://admin.slide.community/': redirect(location),
    })
    expect(failedChecks(results)).toEqual([
      'admin origin is closed outside Access',
    ])
    expect(
      results.find((one) => one.name.startsWith('admin'))?.detail,
    ).toContain('not to Access')
  },
)

test('REL-AC9: Given no Access team host is known, When the operator origin redirects, Then the check fails even to a login-looking address', async () => {
  const { send } = healthy({
    'https://admin.slide.community/': redirect(
      'https://team.cloudflareaccess.com/',
    ),
  })
  const results = await runPostDeployChecks(
    { ...origins, accessTeam: null },
    send,
  )
  expect(failedChecks(results)).toEqual([
    'admin origin is closed outside Access',
  ])
})

test('REL-AC9: Given a deployment that never existed answers 200, When the checks run, Then the content origin check fails', async () => {
  const { results } = await run({ [MISSING]: () => html('served') })
  expect(failedChecks(results)).toEqual([
    'unknown deployment origin is missing',
  ])
})

test('REL-AC9: Given no slide is public, When the checks run, Then the two slide checks are skipped, said so, and do not fail the release', async () => {
  const { results } = await run({
    'https://slide.community/api/public/slides': () => Response.json([]),
  })
  expect(failedChecks(results)).toEqual([])
  expect(
    results.filter((one) => one.state === 'skipped').map((one) => one.name),
  ).toEqual([
    'public slide viewer',
    'public slide is served from its content origin',
  ])
  expect(checkLines(results).join('\n')).toContain('skipped')
})

test.each([
  ['the list is not JSON', () => new Response('<html>', { status: 200 })],
  ['the list is an object', () => Response.json({ href: '/@a/b' })],
  ['an entry has no href', () => Response.json([{ name: 'x' }])],
  [
    'an href is an absolute address',
    () => Response.json([{ href: 'https://evil.example/@a/b' }]),
  ],
  [
    'an href leaves the share path',
    () => Response.json([{ href: '/@a/b/../../admin' }]),
  ],
  ['the list answers 500', () => new Response('x', { status: 500 })],
])(
  'REL-AC8: Given %s, When the checks run, Then the slide checks fail and nothing but the origins given is asked',
  async (_name, list) => {
    const { results, asked } = await run({
      'https://slide.community/api/public/slides': list,
    })
    const failed = failedChecks(results)
    expect(failed).toContain('public slide list')
    expect(failed).toContain('public slide viewer')
    expect(asked.every((url) => !url.includes('evil.example'))).toBe(true)
  },
)

test.each([
  ['the viewer has no frame', () => html('<p>no frame</p>')],
  ['the frame is another site', () => viewer('https://evil.example/')],
  ['the frame is the site itself', () => viewer('https://slide.community/')],
  [
    'the frame is a look-alike host',
    () => viewer('https://d-1.slideusercontent.com.evil.example/'),
  ],
  ['the viewer answers 404', () => html('x', 404)],
])(
  'REL-AC8: Given %s, When the checks run, Then the viewer check fails and the frame is not fetched',
  async (_name, page) => {
    const { results, asked } = await run({
      'https://slide.community/@alice/talk': page,
    })
    expect(failedChecks(results)).toContain('public slide viewer')
    expect(asked.some((url) => url.includes('evil.example'))).toBe(false)
  },
)

test('REL-AC8: Given the slide is not served from its content origin, When the checks run, Then that check fails', async () => {
  const { results } = await run({
    'https://d-1234.slideusercontent.com/': () => html('x', 404),
  })
  expect(failedChecks(results)).toEqual([
    'public slide is served from its content origin',
  ])
})

test.each([
  ['https://slide.community', 'https://slide.community/'],
  ['  https://slide.community/  ', 'https://slide.community/'],
  ['http://localhost:8787', 'http://localhost:8787/'],
  ['http://127.0.0.1:8787/', 'http://127.0.0.1:8787/'],
])(
  'REL-AC9: Given the origin %j, When it is parsed, Then it is accepted as %s',
  (value, expected) => {
    expect(String(parseOrigin(value))).toBe(expected)
  },
)

test.each([
  undefined,
  null,
  '',
  'slide.community',
  'http://slide.community',
  'https://slide.community/path',
  'https://slide.community/?q=1',
  'https://slide.community/#x',
  'https://user:pass@slide.community',
  'ftp://slide.community',
  'javascript:alert(1)',
  42,
])(
  'REL-AC9: Given %j as an origin, When it is parsed, Then it is refused so nothing is checked at a wrong address',
  (value) => {
    expect(parseOrigin(value)).toBeNull()
  },
)
