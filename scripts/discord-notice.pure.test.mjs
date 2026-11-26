import { expect, test } from 'vitest'
import {
  holdsNoPersonalData,
  parseWebhookUrl,
  postToDiscord,
  tell,
} from './discord-notice.mjs'

const WEBHOOK =
  'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123'

test('REL-AC7: Given a Discord webhook address, When it is parsed, Then it is kept; any other address or a stray part is refused', () => {
  expect(parseWebhookUrl(WEBHOOK)).toBe(WEBHOOK)
  expect(parseWebhookUrl(` ${WEBHOOK} `)).toBe(WEBHOOK)
  for (const value of [
    undefined,
    '',
    'not a url',
    WEBHOOK.replace('https:', 'http:'),
    WEBHOOK.replace('discord.com', 'evil.example'),
    WEBHOOK.replace('discord.com', 'discord.com.evil.example'),
    WEBHOOK.replace('discord.com', 'discord.com:8443'),
    WEBHOOK.replace('https://', 'https://user:pw@'),
    `${WEBHOOK}?wait=true`,
    `${WEBHOOK}#x`,
    'https://discord.com/api/webhooks/1/short',
  ])
    expect(parseWebhookUrl(value), String(value)).toBeNull()
})

test('REL-AC7: Given a text, When it is checked, Then an email address or an IP address is refused', () => {
  expect(holdsNoPersonalData('[slide] 反映が途中で止まりました')).toBe(true)
  expect(holdsNoPersonalData('mail a@b.example')).toBe(false)
  expect(holdsNoPersonalData('from 203.0.113.9')).toBe(false)
  expect(holdsNoPersonalData('from 2001:db8::1')).toBe(false)
})

test('REL-AC7: Given a webhook and a clean text, When it is told, Then one POST goes to the webhook with no mention allowed and no redirect followed', async () => {
  const sent = []
  const log = []
  await tell(
    WEBHOOK,
    'hello',
    async (url, init) => {
      sent.push({ url, init })
      return new Response(null, { status: 204 })
    },
    (line) => log.push(line),
  )
  expect(sent).toHaveLength(1)
  expect(sent[0].url).toBe(WEBHOOK)
  expect(sent[0].init.redirect).toBe('manual')
  expect(JSON.parse(sent[0].init.body)).toMatchObject({
    content: 'hello',
    allowed_mentions: { parse: [] },
  })
  expect(log).toEqual(['notice sent'])
})

test.each([undefined, '', 'https://evil.example/hook'])(
  'REL-AC7: Given the webhook is %j, When a text is told, Then nothing is sent and the log says so without the value',
  async (webhook) => {
    const log = []
    const sent = []
    await tell(
      webhook,
      'hello',
      async (...args) => sent.push(args),
      (line) => log.push(line),
    )
    expect(sent).toEqual([])
    expect(log).toHaveLength(1)
    expect(log[0]).toContain('not sent')
    if (webhook) expect(log[0]).not.toContain(webhook)
  },
)

test('REL-AC7: Given a text with an email address, When it is told, Then nothing is sent', async () => {
  const sent = []
  await tell(
    WEBHOOK,
    'a@b.example',
    async (...args) => sent.push(args),
    () => {},
  )
  expect(sent).toEqual([])
})

test('REL-AC7: Given Discord refuses or the network fails, When a text is told, Then the log says which without the address or the answer', async () => {
  const log = []
  await tell(
    WEBHOOK,
    'x',
    async () => new Response('token echoed', { status: 401 }),
    (l) => log.push(l),
  )
  await tell(
    WEBHOOK,
    'x',
    async () => {
      throw new Error(`down ${WEBHOOK}`)
    },
    (l) => log.push(l),
  )
  expect(log).toEqual(['notice refused', 'notice failed'])
})

test('REL-AC7: Given a long text, When it is posted, Then it is cut to what Discord takes', async () => {
  let body
  await postToDiscord(WEBHOOK, 'x'.repeat(5000), async (_url, init) => {
    body = JSON.parse(init.body)
    return new Response(null, { status: 200 })
  })
  expect(body.content).toHaveLength(2000)
})
