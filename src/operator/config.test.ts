import { expect, test } from 'vitest'
import { isOperatorHost, parseOperatorConfig } from './config'

const audience = 'a'.repeat(64)
const settings = {
  origin: 'https://admin.slide.example',
  teamDomain: 'https://team.cloudflareaccess.com',
  audience,
  publicOrigin: 'https://slide.example',
  contentOrigin: 'https://content.example',
}

test('Given complete settings, When they are parsed, Then the operator host and its Access settings are returned', () => {
  expect(parseOperatorConfig(settings)).toEqual({
    host: 'admin.slide.example',
    origin: 'https://admin.slide.example',
    access: { issuer: 'https://team.cloudflareaccess.com', audience },
  })
})

test.each([
  ['no team domain', { teamDomain: undefined }],
  ['an empty team domain', { teamDomain: '' }],
  [
    'a team domain that is not an Access domain',
    { teamDomain: 'https://evil.example' },
  ],
  [
    'a look-alike team domain',
    { teamDomain: 'https://team.cloudflareaccess.com.evil.example' },
  ],
  [
    'a team domain over http',
    { teamDomain: 'http://team.cloudflareaccess.com' },
  ],
  [
    'a team domain with a path',
    { teamDomain: 'https://team.cloudflareaccess.com/x' },
  ],
  ['no audience', { audience: undefined }],
  ['an empty audience', { audience: '' }],
  ['an audience that is not a tag', { audience: 'everyone' }],
])(
  'F17-AC12: Given %s, When the settings are parsed, Then the operator host stays closed',
  (_, change) => {
    expect(parseOperatorConfig({ ...settings, ...change })).toEqual({
      host: 'admin.slide.example',
      origin: 'https://admin.slide.example',
      access: null,
    })
  },
)

test.each([
  ['no origin', undefined],
  ['an empty origin', ''],
  ['an origin that is not a URL', 'admin'],
  ['an origin over http', 'http://admin.slide.example'],
  ['an origin with a path', 'https://admin.slide.example/ops'],
  ['the management origin', 'https://slide.example'],
  ['the content origin', 'https://content.example'],
  ['a deployment origin', 'https://d-1.content.example'],
])(
  'Given %s, When the settings are parsed, Then no operator host is configured',
  (_, origin) => {
    expect(parseOperatorConfig({ ...settings, origin })).toBeNull()
  },
)

test('Given a local operator origin over http, When the settings are parsed, Then it is accepted for development', () => {
  expect(
    parseOperatorConfig({
      ...settings,
      origin: 'http://admin.localhost:8787',
      publicOrigin: 'http://localhost:8787',
    })?.host,
  ).toBe('admin.localhost')
})

test('F17-AC19: Given an operator host, When request URLs are checked, Then only that exact host is the operator host', () => {
  const config = parseOperatorConfig(settings)
  const on = (url: string) => isOperatorHost(config, new URL(url))
  expect(on('https://admin.slide.example/')).toBe(true)
  expect(on('https://admin.slide.example./x')).toBe(true)
  expect(on('https://slide.example/')).toBe(false)
  expect(on('https://x.admin.slide.example/')).toBe(false)
  expect(on('https://admin.slide.example.evil.example/')).toBe(false)
  expect(isOperatorHost(null, new URL('https://admin.slide.example/'))).toBe(
    false,
  )
})

const local = {
  origin: 'http://admin.localhost:8794',
  teamDomain: settings.teamDomain,
  audience,
  publicOrigin: 'http://localhost:8794',
  contentOrigin: 'http://localhost:8794',
}

test('Given the standard local setup, where the content origin is the management origin, When an operator origin beside them is parsed, Then it is accepted', () => {
  expect(parseOperatorConfig(local)).toMatchObject({
    host: 'admin.localhost',
    origin: 'http://admin.localhost:8794',
  })
})

test.each([
  ['the local management origin', 'http://localhost:8794'],
  ['a local deployment origin', 'http://d-1.localhost:8794'],
  ['a host under a local deployment origin', 'http://admin.d-1.localhost:8794'],
])(
  'Given the standard local setup, When the operator origin is %s, Then no operator host is configured',
  (_, origin) => {
    expect(parseOperatorConfig({ ...local, origin })).toBeNull()
  },
)

test('Given a content origin apart from the management origin, When the operator origin is any host under it, Then no operator host is configured', () => {
  for (const origin of [
    'https://admin.content.example',
    'https://d-1.content.example',
  ])
    expect(parseOperatorConfig({ ...settings, origin })).toBeNull()
})
