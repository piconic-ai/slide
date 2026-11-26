import { describe, expect, it } from 'vitest'
import { makeClient, RequestBudgetSpent } from './client.mjs'
import {
  checkAddress,
  checkOrigin,
  isLocalHost,
  RefusedAddress,
} from './origin-guard.mjs'

/** Spellings of the production origins that must all be refused. */
const PRODUCTION = [
  'https://slide.community',
  'http://slide.community',
  'HTTPS://SLIDE.COMMUNITY',
  'https://Slide.Community',
  'https://slide.community.',
  'https://slide.community..',
  'https://slide.community:443',
  'https://slide.community:8443',
  'http://slide.community:80',
  'https://admin.slide.community',
  'https://a.b.slide.community',
  'https://WWW.Slide.Community.:8443',
  'https://slideusercontent.com',
  'https://d-0f8c1e2a.slideusercontent.com',
  'https://D-0F8C1E2A.SlideUserContent.com.',
  'https://deep.d-0f8c1e2a.slideusercontent.com:8443',
  'https://slide%2Ecommunity',
  'https://slide。community',
  'https://ＳＬＩＤＥ.community',
  'https://slide.community/',
  ' https://slide.community ',
]

const NOT_PRODUCTION = [
  'http://localhost:8787',
  'http://localhost',
  'http://127.0.0.1:8811',
  'http://[::1]:8787',
  'http://d-abc.localhost:8787',
  'https://staging.example.test',
  'https://notslide.community',
  'https://slide.community.evil.test',
  'https://slideusercontent.com.example.test',
  'https://xslideusercontent.com',
]

describe('the origin guard', () => {
  it.each(PRODUCTION)(
    'COST-AC4: Given the production spelling %j, When the origin is checked, Then it is refused',
    (input) => {
      expect(checkOrigin(input).ok).toBe(false)
      expect(checkAddress(input).ok).toBe(false)
    },
  )

  it.each(NOT_PRODUCTION)(
    'COST-AC4: Given the address %j that is not production, When the origin is checked, Then it is accepted',
    (input) => {
      expect(checkOrigin(input).ok).toBe(true)
    },
  )

  it.each([
    [undefined],
    [null],
    [42],
    [''],
    ['   '],
    ['not a url'],
    ['localhost:8787'],
    ['ftp://localhost'],
    ['file:///etc/passwd'],
    ['javascript:alert(1)'],
    ['https://user@localhost'],
    ['https://slide.community@127.0.0.1'],
    ['https://user:secret@staging.example.test'],
    ['http://'],
  ])(
    'COST-AC4: Given the unusable input %j, When it is checked, Then it is refused',
    (input) => {
      expect(checkAddress(input).ok).toBe(false)
    },
  )

  it.each([
    ['http://localhost:8787/path'],
    ['http://localhost:8787/?q=1'],
    ['http://localhost:8787/#top'],
  ])(
    'COST-AC4: Given the origin %j with more than an origin, When it is checked as an origin, Then it is refused though the address is fine',
    (input) => {
      expect(checkOrigin(input).ok).toBe(false)
      expect(checkAddress(input).ok).toBe(true)
    },
  )

  it('COST-AC4: Given a local and a remote host, When they are judged, Then only the local one may carry a faked client address', () => {
    expect(isLocalHost('localhost')).toBe(true)
    expect(isLocalHost('d-1.localhost')).toBe(true)
    expect(isLocalHost('127.0.0.1')).toBe(true)
    expect(isLocalHost('[::1]')).toBe(true)
    expect(isLocalHost('staging.example.test')).toBe(false)
    expect(isLocalHost('localhost.evil.test')).toBe(false)
    expect(isLocalHost('128.0.0.1')).toBe(false)
  })
})

/** A client over a fake network that keeps what was sent. */
function clientOver(options = {}) {
  const sent = []
  const records = []
  let time = 0
  const client = makeClient({
    send: async (address, init) => {
      sent.push({ address, init })
      time += 7
      return options.respond?.(address) ?? new Response('ok', { status: 200 })
    },
    now: () => time,
    timeoutSignal: () => new AbortController().signal,
    records,
    maxRequests: options.maxRequests ?? 100,
    timeoutMs: 1000,
    clientIp: options.clientIp ?? null,
  })
  return { client, sent, records }
}

describe('the client', () => {
  it.each(PRODUCTION)(
    'COST-AC4: Given the address %j, When a request is made, Then it is refused before anything is sent and no record is kept',
    async (address) => {
      const { client, sent, records } = clientOver()
      await expect(client.request('probe', address)).rejects.toBeInstanceOf(
        RefusedAddress,
      )
      expect(sent).toEqual([])
      expect(records).toEqual([])
    },
  )

  it('COST-AC4: Given a response that redirects, When the client sends, Then it asks not to follow the redirect', async () => {
    const { client, sent } = clientOver({
      respond: () =>
        new Response(null, {
          status: 302,
          headers: { Location: 'https://slide.community/' },
        }),
    })
    const response = await client.request('probe', 'http://localhost:8787/')
    expect(response.status).toBe(302)
    expect(sent).toHaveLength(1)
    expect(sent[0].init.redirect).toBe('manual')
  })

  it('COST-AC5: Given a response and a failure, When they are sent, Then both are recorded, the failure with no status', async () => {
    let calls = 0
    const { client, records } = clientOver({
      respond: () => {
        calls++
        if (calls === 2) throw new Error('connection refused')
        return new Response('ok', { status: 200 })
      },
    })
    await client.request('a', 'http://localhost:8787/a')
    const failed = await client.request('b', 'http://localhost:8787/b')
    expect(failed.status).toBeNull()
    expect(records).toEqual([
      { name: 'a', status: 200, ms: 7 },
      { name: 'b', status: null, ms: 7 },
    ])
  })

  it('COST-AC4: Given a limit of 2 requests, When a third is made, Then it is not sent', async () => {
    const { client, sent } = clientOver({ maxRequests: 2 })
    await client.request('a', 'http://localhost:8787/a')
    await client.request('a', 'http://localhost:8787/b')
    await expect(
      client.request('a', 'http://localhost:8787/c'),
    ).rejects.toBeInstanceOf(RequestBudgetSpent)
    expect(sent).toHaveLength(2)
  })

  it('COST-AC5: Given a client address, When requests go to a local and a remote host, Then only the local one gets the header', async () => {
    const { client, sent } = clientOver({ clientIp: '203.0.113.7' })
    await client.request('a', 'http://localhost:8787/')
    await client.request('b', 'https://staging.example.test/')
    expect(sent[0].init.headers['CF-Connecting-IP']).toBe('203.0.113.7')
    expect(sent[1].init.headers['CF-Connecting-IP']).toBeUndefined()
  })
})
