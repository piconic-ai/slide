import { expect, test } from 'vitest'
import { parseWebhookUrl as service } from '../../src/alerts/webhook-url'
import { parseWebhookUrl as watcher } from './webhook-url'

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGH-_0123456789'
const GOOD = `https://discord.com/api/webhooks/123456789012345678/${TOKEN}`

// The watcher keeps its own copy of the check, so that it reads none of the
// service's code. This test, which is not deployed, holds the two alike.
test.each([
  GOOD,
  `https://discordapp.com/api/v10/webhooks/123456789012345678/${TOKEN}`,
  undefined,
  '',
  `http://discord.com/api/webhooks/123456789012345678/${TOKEN}`,
  GOOD.replace('discord.com', 'evil.example'),
  `${GOOD}?x=1`,
  `${GOOD}#x`,
  GOOD.replace('https://', 'https://u:p@'),
  GOOD.replace('discord.com', 'discord.com:8443'),
  'https://discord.com/api/webhooks/1/short',
  'not a url',
])(
  'F39-AC10: Given the webhook %s, When both copies read it, Then they agree',
  (value) => {
    expect(watcher(value)).toBe(service(value))
  },
)

test('F39-AC10: Given a Discord webhook, When the watcher reads it, Then it is accepted', () => {
  expect(watcher(GOOD)).toBe(GOOD)
})
