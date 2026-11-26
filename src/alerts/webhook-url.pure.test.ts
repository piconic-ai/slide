import { expect, test } from 'vitest'
import { parseWebhookUrl } from './webhook-url'

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGH-_0123456789'
const GOOD = `https://discord.com/api/webhooks/123456789012345678/${TOKEN}`

test.each([
  GOOD,
  `https://ptb.discord.com/api/webhooks/123456789012345678/${TOKEN}`,
  `https://canary.discord.com/api/webhooks/123456789012345678/${TOKEN}`,
  `https://discordapp.com/api/webhooks/123456789012345678/${TOKEN}`,
  `https://discord.com/api/v10/webhooks/123456789012345678/${TOKEN}`,
  `  ${GOOD}\n`,
])(
  'F39-AC10: Given the webhook %s, When it is read, Then it is accepted',
  (value) => {
    expect(parseWebhookUrl(value)).toBe(value.trim())
  },
)

test.each([
  ['undefined', undefined],
  ['empty', ''],
  ['not a URL', 'not a url'],
  ['plain http', GOOD.replace('https:', 'http:')],
  ['another host', GOOD.replace('discord.com', 'example.com')],
  [
    'a host that only ends like Discord',
    GOOD.replace('discord.com', 'evildiscord.com'),
  ],
  [
    'Discord as a subdomain of another host',
    GOOD.replace('discord.com', 'discord.com.example.com'),
  ],
  [
    'user information that hides the host',
    GOOD.replace('https://', 'https://discord.com@example.com/#'),
  ],
  ['a port', GOOD.replace('discord.com', 'discord.com:8443')],
  ['a query', `${GOOD}?thread_id=1`],
  ['a fragment', `${GOOD}#x`],
  ['a longer path', `${GOOD}/github`],
  [
    'another path',
    `https://discord.com/api/channels/123456789012345678/${TOKEN}`,
  ],
  ['a short id', `https://discord.com/api/webhooks/12/${TOKEN}`],
  ['a short token', 'https://discord.com/api/webhooks/123456789012345678/abc'],
  [
    'a token with a slash',
    `https://discord.com/api/webhooks/123456789012345678/${TOKEN}/x`,
  ],
])(
  'F39-AC10: Given a webhook with %s, When it is read, Then it is not one and nothing would be sent',
  (_, value) => {
    expect(parseWebhookUrl(value)).toBeNull()
  },
)
